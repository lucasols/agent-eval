export { defineEval, getEvalRegistry } from './defineEval.ts';
export { repoFile } from './repoFile.ts';
export {
  setOutput,
  incrementOutput,
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
  tracer,
  span,
  buildTraceTree,
  hashCacheKey,
  type TraceActiveSpan,
  type TraceSpanInfo,
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
  EvalDefinition,
} from './types.ts';
