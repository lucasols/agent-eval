import type { describe as VitestDescribe, it as VitestIt } from 'vitest';
import type { EvalDefinition } from './types.ts';

export type EvalRegistryEntry = {
  id: string;
  title?: string;
  description?: string;
  use: <R>(fn: <TInput, TOutput>(def: EvalDefinition<TInput, TOutput>) => R) => R;
};

const evalRegistry = new Map<string, EvalRegistryEntry>();

let describeFn: typeof VitestDescribe | null = null;
let itFn: typeof VitestIt | null = null;

if (process.env.VITEST) {
  const vitest = await import('vitest');
  describeFn = vitest.describe;
  itFn = vitest.it;
}

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

  const describe = describeFn;
  const it = itFn;
  if (describe && it) {
    describe(definition.title ?? definition.id, () => {
      it.todo(`eval: ${definition.id}`);
    });
  }
}
