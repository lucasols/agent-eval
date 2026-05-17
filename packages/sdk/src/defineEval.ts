import { AsyncLocalStorage } from 'node:async_hooks';
import type { EvalDefinition, EvalOutputs } from './types.ts';

/**
 * Registered eval metadata tracked by the SDK during module loading.
 *
 * Consumers usually access these entries through `getEvalRegistry()`.
 */
export type EvalRegistryEntry = {
  id: string;
  title?: string;
  use: <R>(
    fn: <TInput, TOutputs extends EvalOutputs>(
      def: EvalDefinition<TInput, TOutputs>,
    ) => R,
  ) => R;
};

const evalRegistry = new Map<string, EvalRegistryEntry>();
const evalRegistryStorage = new AsyncLocalStorage<
  Map<string, EvalRegistryEntry>
>();

/** Return the in-memory registry of evals defined in the current process. */
export function getEvalRegistry(): Map<string, EvalRegistryEntry> {
  return evalRegistryStorage.getStore() ?? evalRegistry;
}

/**
 * Execute a callback with an empty async-local eval registry.
 *
 * Runner internals use this when importing eval modules concurrently so
 * `defineEval(...)` calls from one import cannot overwrite another import's
 * registered definitions. The callback receives the scoped registry populated
 * during its async execution.
 */
export async function runWithEvalRegistry<T>(
  fn: (registry: Map<string, EvalRegistryEntry>) => Promise<T> | T,
): Promise<T> {
  const scopedRegistry = new Map<string, EvalRegistryEntry>();
  return await evalRegistryStorage.run(scopedRegistry, async () => {
    return await fn(scopedRegistry);
  });
}

/**
 * Register an eval definition with the SDK so the runner can discover it
 * after importing the eval module.
 */
export function defineEval<
  TInput = unknown,
  TOutputs extends EvalOutputs = EvalOutputs,
>(definition: EvalDefinition<TInput, TOutputs>): void {
  getEvalRegistry().set(definition.id, {
    id: definition.id,
    title: definition.title,
    use: (fn) => fn(definition),
  });
}
