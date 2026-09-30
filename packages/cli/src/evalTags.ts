import { matchesEvalTags as matchesSdkEvalTags } from '@agent-evals/sdk';

/**
 * Augment this interface to narrow accepted tag names for
 * `@ls-stack/agent-eval` imports.
 */
export interface AgentEvalTagRegistry {
  /** Internal marker so the interface can be safely augmented by users. */
  __agentEvalTagRegistry?: never;
}

/** Tag name accepted by eval definitions, config, cases, and runtime checks. */
export type EvalTag = AgentEvalTagRegistry extends { tags: infer T }
  ? Extract<T, string>
  : string;

/** Typed input accepted by {@link matchesEvalTags}. */
export type EvalTagMatchInput =
  | EvalTag
  | { all?: EvalTag[]; any?: EvalTag[]; not?: EvalTag[] };

/** Return whether the active eval case has tags matching the typed input. */
export function matchesEvalTags(input: EvalTagMatchInput): boolean {
  return matchesSdkEvalTags(input);
}
