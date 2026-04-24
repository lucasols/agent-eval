import {
  buildTraceTree,
  EvalAssertionError,
  runInEvalScope,
} from '@agent-evals/sdk';
import type { CacheAdapter, EvalDefinition } from '@agent-evals/sdk';
import type {
  CacheMode,
  CaseDetail,
  CaseRow,
  CellValue,
  ScoreTrace,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import { normalizeScoreDef, toCellValue } from './columnBuilder.ts';
import { persistInlineArtifact } from './outputArtifacts.ts';
import { resolveTracePresentation } from './traceDisplay.ts';

export function filterEvalCases<TInput>(
  cases: { id: string; input: TInput; tags?: string[] }[],
  evalIds: string[] | undefined,
  caseIds: string[] | undefined,
  evalId: string,
): { id: string; input: TInput; tags?: string[] }[] {
  if (evalIds && evalIds.length > 0 && !evalIds.includes(evalId)) {
    return [];
  }

  if (!caseIds || caseIds.length === 0) {
    return cases;
  }

  const selectedCaseIds = new Set(caseIds);
  return cases.filter((evalCase) => selectedCaseIds.has(evalCase.id));
}

export function resolveRunnableEvalCases(params: {
  cases: { id: string; input: unknown; tags?: string[] }[];
  evalId: string;
}): { id: string; input: unknown; tags?: string[] }[] {
  const { cases, evalId } = params;
  if (cases.length > 0) {
    return cases;
  }

  return [{ id: `${evalId}-no-output`, input: {} }];
}

async function callWithUnknownResult(
  fn: CallableFunction,
  args: unknown[],
): Promise<unknown> {
  return await Reflect.apply(fn, undefined, args);
}

export async function runCase<TInput, TRunInput = TInput>(params: {
  evalDef: EvalDefinition<TInput>;
  evalId: string;
  evalCase: { id: string; input: TRunInput; tags?: string[] };
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
  trial: number;
  signal: AbortSignal;
  startTime: number;
  cacheAdapter: CacheAdapter | null;
  cacheMode: CacheMode;
  codeFingerprint: string;
  artifactDir: string;
  runId: string;
}): Promise<{ caseDetail: CaseDetail; caseRowUpdate: Partial<CaseRow> }> {
  const {
    evalDef,
    evalId,
    evalCase,
    globalTraceDisplay,
    trial,
    signal,
    startTime,
    cacheAdapter,
    cacheMode,
    codeFingerprint,
    artifactDir,
    runId,
  } = params;

  const { scope, error: executeError } = await runInEvalScope(
    evalCase.id,
    async () => {
      await Reflect.apply(evalDef.execute, evalDef, [
        { input: evalCase.input, signal },
      ]);
    },
    {
      cacheContext: cacheAdapter
        ? { adapter: cacheAdapter, mode: cacheMode, evalId, codeFingerprint }
        : undefined,
    },
  );

  const traceTree = buildTraceTree(scope.spans, scope.checkpoints);

  const nonAssertError =
    executeError && !(executeError instanceof EvalAssertionError)
      ? executeError
      : null;

  if (
    executeError instanceof EvalAssertionError &&
    scope.assertionFailures.length === 0
  ) {
    scope.assertionFailures.push(
      toAssertionFailure(executeError.message, executeError),
    );
  }

  if (!nonAssertError && evalDef.deriveFromTracing) {
    try {
      const derived = await callWithUnknownResult(evalDef.deriveFromTracing, [
        { trace: traceTree, input: evalCase.input, case: evalCase },
      ]);
      if (!isRecord(derived)) {
        throw new Error('deriveFromTracing must return an object');
      }
      for (const [key, value] of Object.entries(derived)) {
        if (!(key in scope.outputs)) {
          scope.outputs[key] = value;
        }
      }
    } catch (e) {
      const message = `deriveFromTracing threw: ${e instanceof Error ? e.message : String(e)}`;
      scope.assertionFailures.push(
        toAssertionFailure(message, e instanceof Error ? e : undefined),
      );
    }
  }

  const scoreResults = new Map<
    string,
    {
      value: number;
      passThreshold: number | undefined;
      label: string | undefined;
    }
  >();
  const scoringTraces: Record<string, ScoreTrace> = {};
  let scoringCostUsd = 0;

  if (!nonAssertError && evalDef.scores) {
    for (const [key, def] of Object.entries(evalDef.scores)) {
      const { compute, passThreshold, label } = normalizeScoreDef(def);
      const scoreRun = await runInEvalScope(
        evalCase.id,
        async () =>
          await callWithUnknownResult(compute, [
            {
              input: evalCase.input,
              outputs: { ...scope.outputs },
              case: evalCase,
            },
          ]),
        {
          cacheContext: cacheAdapter
            ? {
                adapter: cacheAdapter,
                mode: cacheMode,
                evalId: `${evalId}__score__${key}`,
                codeFingerprint,
              }
            : undefined,
        },
      );

      const scoreCostUsd = getCostUsd(scoreRun.scope.outputs);
      const scoreCostUsdValue = scoreCostUsd ?? 0;
      scoringCostUsd += scoreCostUsdValue;
      const { trace, traceDisplay } = resolveTracePresentation(
        scoreRun.scope.spans,
        globalTraceDisplay,
        evalDef.traceDisplay,
      );
      if (trace.length > 0 || scoreCostUsdValue > 0) {
        scoringTraces[key] = {
          trace,
          traceDisplay,
          cost: { totalUsd: scoreCostUsd },
        };
      }

      const rawValue = scoreRun.result;
      if (scoreRun.error) {
        const message = `score "${key}" threw: ${scoreRun.error.message}`;
        scope.assertionFailures.push(
          toAssertionFailure(message, scoreRun.error),
        );
        scope.outputs[key] = 0;
        scoreResults.set(key, { value: 0, passThreshold, label });
        continue;
      }
      if (typeof rawValue !== 'number') {
        scope.assertionFailures.push(
          toAssertionFailure(`score "${key}" must return a number`),
        );
        scope.outputs[key] = 0;
        scoreResults.set(key, { value: 0, passThreshold, label });
        continue;
      }

      const value = rawValue;
      scope.outputs[key] = value;
      scoreResults.set(key, { value, passThreshold, label });
    }
  }

  let passed = scope.assertionFailures.length === 0 && !nonAssertError;
  if (passed) {
    for (const [, scoreEntry] of scoreResults) {
      if (
        scoreEntry.passThreshold !== undefined &&
        scoreEntry.value < scoreEntry.passThreshold
      ) {
        passed = false;
        break;
      }
    }
  }

  const status: CaseRow['status'] = nonAssertError
    ? 'error'
    : passed
      ? 'pass'
      : 'fail';

  const { trace: displayTrace, traceDisplay } = resolveTracePresentation(
    scope.spans,
    globalTraceDisplay,
    evalDef.traceDisplay,
  );

  const columns: Record<string, CellValue> = {};
  for (const [key, value] of Object.entries(scope.outputs)) {
    const cell = isBlob(value)
      ? await persistInlineArtifact({
          artifactDir,
          runId,
          caseId: evalCase.id,
          outputKey: key,
          trial,
          value,
        })
      : toCellValue(value, evalDef.columns?.[key]);
    if (cell !== undefined) {
      columns[key] = cell;
    }
  }
  for (const key of Object.keys(evalDef.manualScores ?? {})) {
    columns[key] = null;
  }

  const executionCostUsd = getCostUsd(scope.outputs);
  const costUsd =
    executionCostUsd === null && scoringCostUsd === 0
      ? null
      : (executionCostUsd ?? 0) + scoringCostUsd;

  const errorInfo = nonAssertError
    ? {
        name: nonAssertError.name,
        message: nonAssertError.message,
        stack: nonAssertError.stack,
      }
    : null;

  const caseDetail: CaseDetail = {
    caseId: evalCase.id,
    evalId,
    status,
    input: evalCase.input,
    trace: displayTrace,
    traceDisplay,
    cost: { totalUsd: costUsd },
    columns,
    assertionFailures: scope.assertionFailures,
    error: errorInfo,
    trial,
  };
  if (Object.keys(scoringTraces).length > 0) {
    caseDetail.scoringTraces = scoringTraces;
  }

  const elapsedMs = Date.now() - startTime;

  const caseRowUpdate: Partial<CaseRow> = {
    status,
    latencyMs: elapsedMs,
    costUsd,
    columns,
  };

  return { caseDetail, caseRowUpdate };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBlob(value: unknown): value is Blob {
  return value instanceof Blob;
}

function getCostUsd(outputs: Record<string, unknown>): number | null {
  const raw = outputs['costUsd'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function toAssertionFailure(
  message: string,
  error: Error | undefined = undefined,
) {
  return error?.stack ? { message, stack: error.stack } : { message };
}
