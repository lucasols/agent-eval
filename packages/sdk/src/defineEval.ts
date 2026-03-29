import { describe, it } from 'vitest';
import type { EvalDefinition } from './types.ts';

const evalRegistry = new Map<string, EvalDefinition>();

export function getEvalRegistry(): Map<string, EvalDefinition> {
  return evalRegistry;
}

export function defineEval<TInput, TOutput>(
  definition: EvalDefinition<TInput, TOutput>,
): void {
  evalRegistry.set(definition.id, definition as EvalDefinition);

  describe(definition.title ?? definition.id, () => {
    it.todo(`eval: ${definition.id}`);
  });
}
