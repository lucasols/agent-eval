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
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import { normalizeScoreDef, toCellValue } from './columnBuilder.ts';
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

export async function runCase<TInput>(params: {
  evalDef: EvalDefinition<TInput>;
  evalId: string;
  evalCase: { id: string; input: TInput; tags?: string[] };
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
  trial: number;
  signal: AbortSignal;
  startTime: number;
  cacheAdapter: CacheAdapter | null;
  cacheMode: CacheMode;
  codeFingerprint: string;
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
  } = params;

  const { scope, error: executeError } = await runInEvalScope(
    evalCase.id,
    async () => {
      await evalDef.execute({ input: evalCase.input, signal });
    },
    {
      cacheContext: cacheAdapter
        ? { adapter: cacheAdapter, mode: cacheMode, evalId, codeFingerprint }
        : undefined,
    },
  );

  const elapsedMs = Date.now() - startTime;
  const traceTree = buildTraceTree(scope.spans, scope.checkpoints);

  const nonAssertError =
    executeError && !(executeError instanceof EvalAssertionError)
      ? executeError
      : null;

  if (!nonAssertError && evalDef.deriveFromTracing) {
    try {
      const derived = await evalDef.deriveFromTracing({
        trace: traceTree,
        input: evalCase.input,
        case: evalCase,
      });
      for (const [key, value] of Object.entries(derived)) {
        if (!(key in scope.outputs)) {
          scope.outputs[key] = value;
        }
      }
    } catch (e) {
      scope.assertionFailures.push(
        `deriveFromTracing threw: ${e instanceof Error ? e.message : String(e)}`,
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

  if (!nonAssertError && evalDef.scores) {
    for (const [key, def] of Object.entries(evalDef.scores)) {
      const { compute, passThreshold, label } = normalizeScoreDef(def);
      try {
        const value = await compute({
          input: evalCase.input,
          outputs: scope.outputs,
          case: evalCase,
        });
        scope.outputs[key] = value;
        scoreResults.set(key, { value, passThreshold, label });
      } catch (e) {
        scope.assertionFailures.push(
          `score "${key}" threw: ${e instanceof Error ? e.message : String(e)}`,
        );
        scope.outputs[key] = 0;
        scoreResults.set(key, { value: 0, passThreshold, label });
      }
    }
  }

  const scoreValues = [...scoreResults.values()].map((s) => s.value);
  const avgScore =
    scoreValues.length > 0
      ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
      : null;
  const casePassThreshold = evalDef.passThreshold ?? 0.5;

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
  if (passed && avgScore !== null && avgScore < casePassThreshold) {
    passed = false;
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
    const cell = toCellValue(value);
    if (cell !== undefined) {
      columns[key] = cell;
    }
  }

  const costUsdRaw = scope.outputs['costUsd'];
  const costUsd = typeof costUsdRaw === 'number' ? costUsdRaw : null;

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

  const caseRowUpdate: Partial<CaseRow> = {
    status,
    score: avgScore,
    latencyMs: elapsedMs,
    costUsd,
    columns,
  };

  return { caseDetail, caseRowUpdate };
}
