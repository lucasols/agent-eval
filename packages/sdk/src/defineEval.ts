import { describe, it } from 'vitest';
import type { EvalDefinition } from './types.ts';

export type EvalRegistryEntry = {
  id: string;
  title?: string;
  description?: string;
  use: <R>(fn: <TInput, TOutput>(def: EvalDefinition<TInput, TOutput>) => R) => R;
};

const evalRegistry = new Map<string, EvalRegistryEntry>();

export function getEvalRegistry(): Map<string, EvalRegistryEntry> {
  return evalRegistry;
}

export function defineEval<TInput, TOutput>(
  definition: EvalDefinition<TInput, TOutput>,
): void {
  evalRegistry.set(definition.id, {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    use: (fn) => fn(definition),
  });

  describe(definition.title ?? definition.id, () => {
    it.todo(`eval: ${definition.id}`);
  });
}
