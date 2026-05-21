import { relative } from 'node:path';
import {
  buildTraceTree,
  EvalAssertionError,
  EvalRuntimeUsageError,
  getEvalClockStateTimeMs,
  runInExistingEvalScope,
  runInEvalScope,
  setEvalOutput,
} from '@agent-evals/sdk';
import type {
  CacheAdapter,
  EvalCaseScope,
  EvalDefinition,
  EvalOutputs,
} from '@agent-evals/sdk';
import type {
  AssertionFailure,
  CacheMode,
  CaseDetail,
  CaseRow,
  CellValue,
  EvalDeriveConfig,
  EvalTracingAssertionsConfig,
  EvalColumns,
  EvalTraceTree,
  RemoveDefaultConfig,
  ResolvedApiCallsConfig,
  ResolvedLlmCallsConfig,
  ScoreTrace,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import {
  buildCaseKey,
  applyDerivedCallAttributes,
  extractCacheEntries,
  resolveApiCallsConfig,
  resolveLlmCallsConfig,
} from '@agent-evals/shared';
import { z } from 'zod';
import {
  buildRuntimeOutputColumnDefs,
  normalizeScoreDef,
  toCellValue,
} from './columnBuilder.ts';
import { addDefaultOutputs, mergeDefaultColumns } from './defaultConfig.ts';
import { runWithModuleIsolation } from './moduleIsolation.ts';
import { persistInlineArtifact } from './outputArtifacts.ts';
import { stripTerminalControlCodes } from './stackFormatting.ts';
import { resolveTracePresentation } from './traceDisplay.ts';

export function filterEvalCases<TInput>(
  cases: { id: string; input: TInput; tags: string[] }[],
  caseIds: string[] | undefined,
): { id: string; input: TInput; tags: string[] }[] {
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

async function callUnknownFunction(
  fn: unknown,
  args: unknown[],
): Promise<unknown> {
  if (typeof fn !== 'function') {
    throw new Error('Expected a function');
  }
  return await Reflect.apply(fn, undefined, args);
}

function assignDerivedOutputs(params: {
  outputs: Record<string, unknown>;
  derived: Record<string, unknown>;
}): void {
  for (const [key, value] of Object.entries(params.derived)) {
    if (key in params.outputs) continue;
    params.outputs[key] = value;
  }
}

async function resolveDeriveFromTracingConfig<TInput>(params: {
  deriveFromTracing: EvalDeriveConfig<TInput>;
  traceTree: EvalTraceTree;
  evalCase: { id: string; input: unknown; tags?: string[] };
}): Promise<Record<string, unknown>> {
  const ctx = {
    trace: params.traceTree,
    input: params.evalCase.input,
    case: params.evalCase,
  };
  if (typeof params.deriveFromTracing === 'function') {
    const derived = await callUnknownFunction(params.deriveFromTracing, [ctx]);
    if (!isRecord(derived)) {
      throw new Error('deriveFromTracing must return an object');
    }
    return derived;
  }

  const derived: Record<string, unknown> = {};
  for (const [key, compute] of Object.entries(params.deriveFromTracing)) {
    const value = await callUnknownFunction(compute, [ctx]);
    if (value !== undefined) {
      derived[key] = value;
    }
  }
  return derived;
}

async function runDeriveFromTracingConfig<TInput>(params: {
  deriveFromTracing: EvalDeriveConfig<TInput> | undefined;
  scope: EvalCaseScope;
  traceTree: EvalTraceTree;
  evalCase: { id: string; input: unknown; tags?: string[] };
}): Promise<Error | null> {
  if (params.deriveFromTracing === undefined) return null;
  const { deriveFromTracing } = params;

  try {
    const derived = await runInExistingEvalScope(
      params.scope,
      'derive',
      async () =>
        await resolveDeriveFromTracingConfig({
          deriveFromTracing,
          traceTree: params.traceTree,
          evalCase: params.evalCase,
        }),
    );
    assignDerivedOutputs({ outputs: params.scope.outputs, derived });
    return null;
  } catch (e) {
    if (e instanceof EvalRuntimeUsageError) return e;

    const message = `deriveFromTracing threw: ${e instanceof Error ? e.message : String(e)}`;
    recordAssertionFailure(
      params.scope,
      toAssertionFailure(message, e instanceof Error ? e : undefined),
    );
    return null;
  }
}

async function runOneTracingAssertion(params: {
  label: string;
  tracingAssertion: unknown;
  scope: EvalCaseScope;
  traceTree: EvalTraceTree;
  evalCase: { id: string; input: unknown; tags?: string[] };
}): Promise<void> {
  const { label, tracingAssertion, scope, traceTree, evalCase } = params;
  const failureCountBefore = scope.assertionFailures.length;
  const ctx = { trace: traceTree, input: evalCase.input, case: evalCase };

  try {
    await runInExistingEvalScope(scope, 'tracingAssertions', async () => {
      await callUnknownFunction(tracingAssertion, [ctx]);
    });
  } catch (e) {
    if (
      e instanceof EvalAssertionError &&
      scope.assertionFailures.length > failureCountBefore
    ) {
      return;
    }

    const message = `${label} threw: ${e instanceof Error ? e.message : String(e)}`;
    recordAssertionFailure(
      scope,
      toAssertionFailure(message, e instanceof Error ? e : undefined),
    );
  }
}

async function runTracingAssertionsConfig<TInput>(params: {
  tracingAssertions: EvalTracingAssertionsConfig<TInput> | undefined;
  scope: EvalCaseScope;
  traceTree: EvalTraceTree;
  evalCase: { id: string; input: unknown; tags?: string[] };
}): Promise<void> {
  if (params.tracingAssertions === undefined) return;

  await runOneTracingAssertion({
    label: 'tracingAssertions',
    tracingAssertion: params.tracingAssertions,
    scope: params.scope,
    traceTree: params.traceTree,
    evalCase: params.evalCase,
  });
}

export async function runCase<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
  TRunInput = TInput,
>(params: {
  evalDef: EvalDefinition<TInput, TOutputs>;
  evalId: string;
  evalKey?: string;
  evalCase: { id: string; input: TRunInput; tags?: string[] };
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
  globalColumns?: EvalColumns;
  globalDeriveFromTracing?: EvalDeriveConfig<TRunInput>;
  globalTracingAssertions?: EvalTracingAssertionsConfig<TRunInput>;
  llmCallsConfig?: ResolvedLlmCallsConfig;
  apiCallsConfig?: ResolvedApiCallsConfig;
  globalRemoveDefaultConfig?: RemoveDefaultConfig;
  trial: number;
  startTime: number;
  cacheAdapter: CacheAdapter | null;
  cacheMode: CacheMode;
  moduleIsolation: { key: string; workspaceRoot: string } | undefined;
  evalFilePath: string;
  evalFileRelativePath?: string;
  workspaceRoot: string;
  artifactDir: string;
  runId: string;
}): Promise<{ caseDetail: CaseDetail; caseRowUpdate: Partial<CaseRow> }> {
  const {
    evalDef,
    evalId,
    evalKey = evalId,
    evalCase,
    globalTraceDisplay,
    globalColumns,
    globalDeriveFromTracing,
    globalTracingAssertions,
    llmCallsConfig = resolveLlmCallsConfig(undefined),
    apiCallsConfig = resolveApiCallsConfig(undefined),
    globalRemoveDefaultConfig,
    trial,
    startTime,
    cacheAdapter,
    cacheMode,
    moduleIsolation,
    evalFilePath,
    evalFileRelativePath = evalFilePath,
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
  const caseKey = buildCaseKey({
    filePath: evalFileRelativePath,
    evalId,
    caseId: evalCase.id,
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
      tags: evalCase.tags ?? [],
      idPrefix: scopedIdPrefix,
      waitForBackgroundJobs: evalDef.waitForBackgroundJobs !== false,
      cacheContext: cacheAdapter
        ? {
            adapter: cacheAdapter,
            mode: cacheMode,
            evalId,
            read: evalDef.cache?.read,
            store: evalDef.cache?.store,
          }
        : undefined,
      startTime: evalDef.startTime,
      freezeTime: evalDef.freezeTime,
    },
  );

  const spansWithDerivedAttributes = applyDerivedCallAttributes({
    spans: scope.spans,
    llmCallsConfig,
    apiCallsConfig,
  });

  const traceTree = buildTraceTree(
    spansWithDerivedAttributes,
    scope.checkpoints,
  );

  let nonAssertError =
    executeError && !(executeError instanceof EvalAssertionError)
      ? executeError
      : null;

  if (
    executeError instanceof EvalAssertionError &&
    scope.assertionFailures.length === 0
  ) {
    recordAssertionFailure(
      scope,
      toAssertionFailure(executeError.message, executeError),
    );
  }

  if (!nonAssertError) {
    nonAssertError = await runDeriveFromTracingConfig({
      deriveFromTracing: globalDeriveFromTracing,
      scope,
      traceTree,
      evalCase,
    });
    if (!nonAssertError) {
      nonAssertError = await runDeriveFromTracingConfig({
        deriveFromTracing: evalDef.deriveFromTracing,
        scope,
        traceTree,
        evalCase,
      });
    }
  }

  if (!nonAssertError) {
    await runTracingAssertionsConfig({
      tracingAssertions: globalTracingAssertions,
      scope,
      traceTree,
      evalCase,
    });
    await runTracingAssertionsConfig({
      tracingAssertions: evalDef.tracingAssertions,
      scope,
      traceTree,
      evalCase,
    });
  }

  if (!nonAssertError) {
    addDefaultOutputs({
      outputs: scope.outputs,
      spans: spansWithDerivedAttributes,
      llmCallsConfig,
      apiCallsConfig,
      globalRemove: globalRemoveDefaultConfig,
      evalRemove: evalDef.removeDefaultConfig,
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
      recordAssertionFailure(
        scope,
        toAssertionFailure(
          formatOutputsSchemaError(parsedOutputs.error),
          undefined,
          'OutputsSchemaError',
        ),
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
  const scoreStartTime =
    getEvalClockStateTimeMs(scope.evalClockState) ?? evalDef.startTime;

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
          tags: evalCase.tags ?? [],
          idPrefix: `${scopedIdPrefix}-score-${toStableIdSegment(key)}`,
          runtimeScope: 'scorer',
          cacheContext: cacheAdapter
            ? {
                adapter: cacheAdapter,
                mode: cacheMode,
                evalId: `${evalId}__score__${key}`,
                read: evalDef.cache?.read,
                store: evalDef.cache?.store,
              }
            : undefined,
          startTime: scoreStartTime,
          freezeTime: evalDef.freezeTime,
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
      if (trace.length > 0 || scoreRun.scope.caseCacheRefs.length > 0) {
        scoringTraces[key] = {
          trace,
          traceDisplay,
          cacheRefs: scoreRun.scope.caseCacheRefs,
        };
      }

      const rawValue = scoreRun.result;
      if (scoreRun.error) {
        const message = `score "${key}" threw: ${scoreRun.error.message}`;
        recordAssertionFailure(
          scope,
          toAssertionFailure(message, scoreRun.error),
        );
        scope.outputs[key] = 0;
        scoreResults.set(key, { value: 0, passThreshold, label });
        continue;
      }
      if (typeof rawValue !== 'number') {
        recordAssertionFailure(
          scope,
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
    spansWithDerivedAttributes,
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
      : await toCellValue(value);
    if (cell !== undefined) {
      columns[key] = cell;
    }
  }
  for (const key of Object.keys(evalDef.manualScores ?? {})) {
    columns[key] = null;
  }
  const outputColumnDefs = buildRuntimeOutputColumnDefs(
    columns,
    scope.outputColumnOverrides,
    new Set(
      Object.keys(
        mergeDefaultColumns({
          globalColumns,
          columns: evalDef.columns,
          globalRemove: globalRemoveDefaultConfig,
          evalRemove: evalDef.removeDefaultConfig,
        }) ?? {},
      ),
    ),
  );

  const errorInfo = nonAssertError
    ? {
        name: nonAssertError.name,
        message: nonAssertError.message,
        stack: nonAssertError.stack,
      }
    : null;

  const caseDetail: CaseDetail = {
    evalKey,
    caseKey,
    caseId: evalCase.id,
    evalId,
    tags: evalCase.tags ?? [],
    status,
    input: evalCase.input,
    trace: displayTrace,
    traceDisplay,
    columns,
    ...(outputColumnDefs.length > 0 ? { outputColumnDefs } : {}),
    assertions: scope.assertions,
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
  const cacheEntries = extractCacheEntries(displayTrace, scope.caseCacheRefs);
  const cacheHits = cacheEntries.filter((entry) => entry.status === 'hit');

  const caseRowUpdate: Partial<CaseRow> = {
    tags: evalCase.tags ?? [],
    status,
    durationMs: elapsedMs,
    cacheHits: cacheHits.length,
    cacheOperations: cacheEntries.length,
    columns,
    ...(outputColumnDefs.length > 0 ? { outputColumnDefs } : {}),
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
    return 'outputs did not match the configured schema';
  }
  return issueLines.join('\n');
}

function toAssertionFailure(
  message: string,
  error: Error | undefined = undefined,
  nameOverride: string | undefined = undefined,
): AssertionFailure {
  const name = nameOverride ?? error?.name;
  const stack = error?.stack
    ? stripTerminalControlCodes(error.stack)
    : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    message,
    ...(stack !== undefined ? { stack } : {}),
  };
}

function recordAssertionFailure(
  scope: EvalCaseScope,
  failure: AssertionFailure,
): void {
  scope.assertionFailures.push(failure);
  scope.assertions.push({ ...failure, status: 'fail' });
}
