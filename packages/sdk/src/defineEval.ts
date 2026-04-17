import type { describe as VitestDescribe, it as VitestIt } from 'vitest';
import type { EvalDefinition } from './types.ts';

/**
 * Registered eval metadata tracked by the SDK during module loading.
 *
 * Consumers usually access these entries through `getEvalRegistry()`.
 */
export type EvalRegistryEntry = {
  id: string;
  title?: string;
  description?: string;
  use: <R>(fn: <TInput>(def: EvalDefinition<TInput>) => R) => R;
};

const evalRegistry = new Map<string, EvalRegistryEntry>();

let describeFn: typeof VitestDescribe | null = null;
let itFn: typeof VitestIt | null = null;

if (process.env.VITEST) {
  const vitest = await import('vitest');
  describeFn = vitest.describe;
  itFn = vitest.it;
}

/** Return the in-memory registry of evals defined in the current process. */
export function getEvalRegistry(): Map<string, EvalRegistryEntry> {
  return evalRegistry;
}

/**
 * Register an eval definition with the SDK and expose it to the runner.
 *
 * When invoked inside Vitest, this also creates a placeholder test so eval
 * files appear in the test tree.
 */
export function defineEval<TInput>(definition: EvalDefinition<TInput>): void {
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
