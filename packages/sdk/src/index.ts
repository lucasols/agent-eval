export { defineEval, getEvalRegistry } from './defineEval.ts';
export { repoFile } from './repoFile.ts';
export {
  setEvalOutput,
  incrementEvalOutput,
  evalAssert,
  EvalAssertionError,
  runInEvalScope,
  getCurrentScope,
  isInEvalScope,
  setScopeCacheContext,
  type EvalCaseScope,
  type CacheAdapter,
  type CacheScopeContext,
  type CacheRecordingFrame,
  type RunInEvalScopeOptions,
} from './runtime.ts';
export {
  evalTracer,
  evalSpan,
  buildTraceTree,
  hashCacheKey,
  hashCacheKeySync,
  type TraceActiveSpan,
  type TraceExternalSpanEndInfo,
  type TraceExternalSpanHandle,
  type TraceExternalSpanRecordInfo,
  type TraceExternalSpanStartInfo,
  type TraceExternalSpanUpdateInfo,
  type TraceSpanInfo,
  type TraceSpanTimestamp,
} from './tracer.ts';
export type { FileRef, RepoFileRef, RunArtifactRef } from '@agent-evals/shared';
export type {
  EvalCase,
  EvalColumnOverride,
  EvalColumns,
  EvalTraceTree,
  EvalExecuteContext,
  EvalDeriveContext,
  EvalScoreContext,
  EvalScoreFn,
  EvalScoreDef,
  EvalManualScoreDef,
  EvalDefinition,
} from './types.ts';
