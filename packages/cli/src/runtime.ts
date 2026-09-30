/**
 * Lightweight entry for product code that runs outside evals too.
 *
 * It exposes only the eval runtime helpers (scope checks, tracing, outputs and
 * assertions) without the runner, the CLI and their schemas, so importing it
 * in a production process doesn't load the whole eval tool. It shares the eval
 * scope with the main entry, so helpers imported from here see the scopes
 * started by the runner.
 */
export {
  setEvalOutput,
  appendToEvalOutput,
  incrementEvalOutput,
  mergeEvalOutput,
  evalLog,
  evalAssert,
  evalExpect,
  getEvalCaseInput,
  evalTime,
  startEvalBackgroundJob,
  nextEvalId,
  EvalAssertionError,
  EvalRuntimeUsageError,
  getCurrentScope,
  isInEvalScope,
  captureEvalSpanError,
  evalTracer,
  evalSpan,
  type CaptureEvalSpanErrorLevel,
  type CaptureEvalSpanErrorOptions,
  type EvalCaseScope,
  type EvalExpectation,
  type EvalRuntimeScope,
  type EvalTraceTree,
  type TraceActiveSpan,
  type TraceCache,
  type TraceCacheGetResult,
  type TraceCacheInfo,
  type TraceCacheManualInfo,
  type TraceCacheRef,
  type TraceCacheSetInfo,
  type TraceSpanInfo,
} from '@agent-evals/sdk';
export {
  matchesEvalTags,
  type AgentEvalTagRegistry,
  type EvalTag,
  type EvalTagMatchInput,
} from './evalTags.ts';
