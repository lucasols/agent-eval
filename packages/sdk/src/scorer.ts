import type { EvalCase, EvalRuntimeContext, EvalTraceTree, ScoreResult } from './types.ts';

export function createScorer<TInput, TOutput>(
  id: string,
  fn: (ctx: {
    case: EvalCase<TInput>;
    input: TInput;
    output: TOutput;
    trace: EvalTraceTree;
    runtime: EvalRuntimeContext;
  }) => Promise<ScoreResult> | ScoreResult,
): (ctx: {
  case: EvalCase<TInput>;
  input: TInput;
  output: TOutput;
  trace: EvalTraceTree;
  runtime: EvalRuntimeContext;
}) => Promise<ScoreResult> | ScoreResult {
  return (ctx) => {
    const result = fn(ctx);
    if (result instanceof Promise) {
      return result.then((r) => ({ ...r, id: r.id || id }));
    }
    return { ...result, id: result.id || id };
  };
}
