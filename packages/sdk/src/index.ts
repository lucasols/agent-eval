export { defineEval, getEvalRegistry } from './defineEval.ts';
export { blocks } from './blocks.ts';
export { repoFile } from './repoFile.ts';
export {
  setOutput,
  incrementOutput,
  evalAssert,
  EvalAssertionError,
  runInEvalScope,
  getCurrentScope,
  type EvalCaseScope,
} from './runtime.ts';
export { tracer, buildTraceTree, type TraceActiveSpan } from './tracer.ts';
export type { DisplayBlock, FileRef } from '@agent-evals/shared';
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
