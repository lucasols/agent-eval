import { relative } from 'node:path';
import {
  buildTraceTree,
  EvalAssertionError,
  runInExistingEvalScope,
  runInEvalScope,
  setEvalOutput,
} from '@agent-evals/sdk';
import type {
  CacheAdapter,
  EvalDefinition,
  EvalOutputs,
} from '@agent-evals/sdk';
import type {
  AssertionFailure,
  CacheMode,
  CaseDetail,
  CaseRow,
  CellValue,
  RemoveDefaultLLMConfig,
  ResolvedLlmCallsConfig,
  ScoreTrace,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import { resolveLlmCallsConfig } from '@agent-evals/shared';
import { z } from 'zod/v4';
import { normalizeScoreDef, toCellValue } from './columnBuilder.ts';
import {
  addDefaultLlmOutputs,
  mergeDefaultLlmColumns,
} from './defaultLlmConfig.ts';
import { runWithModuleIsolation } from './moduleIsolation.ts';
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

function toStableIdSegment(value: string): string {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return segment.length > 0 ? segment : 'id';
}

export function buildScopedEvalIdPrefix(params: {
  evalId: string;
  evalFilePath: string;
  caseId: string;
  workspaceRoot: string;
}): string {
  const fileIdentity = relative(
    params.workspaceRoot,
    params.evalFilePath,
  ).replaceAll('\\', '/');
  return [
    toStableIdSegment(params.evalId),
    toStableIdSegment(fileIdentity),
    toStableIdSegment(params.caseId),
  ].join('-');
}

async function callWithUnknownResult(
  fn: CallableFunction,
  args: unknown[],
): Promise<unknown> {
  return await Reflect.apply(fn, undefined, args);
}

export async function runCase<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
  TRunInput = TInput,
>(params: {
  evalDef: EvalDefinition<TInput, TOutputs>;
  evalId: string;
  evalCase: { id: string; input: TRunInput; tags?: string[] };
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
  llmCallsConfig?: ResolvedLlmCallsConfig;
  globalRemoveDefaultLLMConfig?: RemoveDefaultLLMConfig;
  trial: number;
  startTime: number;
  cacheAdapter: CacheAdapter | null;
  cacheMode: CacheMode;
  codeFingerprint: string;
  moduleIsolation: { key: string; workspaceRoot: string } | undefined;
  evalFilePath: string;
  workspaceRoot: string;
  artifactDir: string;
  runId: string;
}): Promise<{ caseDetail: CaseDetail; caseRowUpdate: Partial<CaseRow> }> {
  const {
    evalDef,
    evalId,
    evalCase,
    globalTraceDisplay,
    llmCallsConfig = resolveLlmCallsConfig(undefined),
    globalRemoveDefaultLLMConfig,
    trial,
    startTime,
    cacheAdapter,
    cacheMode,
    codeFingerprint,
    moduleIsolation,
    evalFilePath,
    workspaceRoot,
    artifactDir,
    runId,
  } = params;
  const scopedIdPrefix = buildScopedEvalIdPrefix({
    evalId,
    evalFilePath,
    caseId: evalCase.id,
    workspaceRoot,
  });

  const { scope, error: executeError } = await runInEvalScope(
    evalCase.id,
    async () => {
      const execute = async () => {
        await Reflect.apply(evalDef.execute, evalDef, [
          { input: evalCase.input, setOutput: setEvalOutput },
        ]);
      };
      if (moduleIsolation === undefined) {
        await execute();
        return;
      }
      await runWithModuleIsolation(moduleIsolation, execute);
    },
    {
      input: evalCase.input,
      idPrefix: scopedIdPrefix,
      waitForBackgroundJobs: evalDef.waitForBackgroundJobs !== false,
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
    const { deriveFromTracing } = evalDef;
    try {
      const derived = await runInExistingEvalScope(
        scope,
        'derive',
        async () => {
          return await callWithUnknownResult(deriveFromTracing, [
            { trace: traceTree, input: evalCase.input, case: evalCase },
          ]);
        },
      );
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

  if (!nonAssertError) {
    addDefaultLlmOutputs({
      outputs: scope.outputs,
      spans: scope.spans,
      llmCallsConfig,
      globalRemove: globalRemoveDefaultLLMConfig,
      evalRemove: evalDef.removeDefaultLLMConfig,
    });
  }

  if (!nonAssertError && evalDef.outputsSchema) {
    const { outputsSchema } = evalDef;
    const parsedOutputs = await runInExistingEvalScope(
      scope,
      'outputsSchema',
      () =>
        outputsSchema.safeParse(
          getOutputsSchemaInput(outputsSchema, scope.outputs),
        ),
    );
    if (parsedOutputs.success) {
      scope.outputs = { ...scope.outputs, ...parsedOutputs.data };
    } else {
      scope.assertionFailures.push(
        toAssertionFailure(formatOutputsSchemaError(parsedOutputs.error)),
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

  if (
    !nonAssertError &&
    scope.assertionFailures.length === 0 &&
    evalDef.scores
  ) {
    for (const [key, def] of Object.entries(evalDef.scores)) {
      const { compute, passThreshold, label } = normalizeScoreDef(def);
      const scoreRun = await runInEvalScope(
        evalCase.id,
        async () => {
          const computeScore = async () =>
            await callWithUnknownResult(compute, [
              {
                input: evalCase.input,
                outputs: { ...scope.outputs },
                case: evalCase,
              },
            ]);
          if (moduleIsolation === undefined) {
            return await computeScore();
          }
          return await runWithModuleIsolation(moduleIsolation, computeScore);
        },
        {
          input: evalCase.input,
          idPrefix: `${scopedIdPrefix}-score-${toStableIdSegment(key)}`,
          runtimeScope: 'scorer',
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

      const { trace, traceDisplay } = resolveTracePresentation(
        scoreRun.scope.spans,
        globalTraceDisplay,
        evalDef.traceDisplay,
      );
      scope.logs.push(
        ...scoreRun.scope.logs.map((entry) => ({ ...entry, source: key })),
      );
      if (trace.length > 0) {
        scoringTraces[key] = { trace, traceDisplay };
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
  const columnOverrides = mergeDefaultLlmColumns({
    columns: evalDef.columns,
    globalRemove: globalRemoveDefaultLLMConfig,
    evalRemove: evalDef.removeDefaultLLMConfig,
  });
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
      : toCellValue(value, columnOverrides?.[key]);
    if (cell !== undefined) {
      columns[key] = cell;
    }
  }
  for (const key of Object.keys(evalDef.manualScores ?? {})) {
    columns[key] = null;
  }

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
    columns,
    assertionFailures: scope.assertionFailures,
    logs: scope.logs,
    error: errorInfo,
    trial,
    cacheRefs: scope.caseCacheRefs,
  };
  if (Object.keys(scoringTraces).length > 0) {
    caseDetail.scoringTraces = scoringTraces;
  }

  const elapsedMs = Date.now() - startTime;

  const caseRowUpdate: Partial<CaseRow> = {
    status,
    latencyMs: elapsedMs,
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

function getOutputsSchemaInput<TOutputs extends EvalOutputs>(
  schema: z.ZodType<TOutputs>,
  outputs: EvalOutputs,
): unknown {
  if (!(schema instanceof z.ZodObject)) return outputs;

  const configuredOutputs: EvalOutputs = {};
  for (const key of Object.keys(schema.shape)) {
    if (key in outputs) {
      configuredOutputs[key] = outputs[key];
    }
  }
  return configuredOutputs;
}

function formatOutputsSchemaError(error: z.ZodError): string {
  const issueLines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
  if (issueLines.length === 0) {
    return 'outputsSchema validation failed';
  }
  return `outputsSchema validation failed:\n${issueLines.join('\n')}`;
}

function toAssertionFailure(
  message: string,
  error: Error | undefined = undefined,
): AssertionFailure {
  return error?.stack ? { message, stack: error.stack } : { message };
}
