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

/** Return the in-memory registry of evals defined in the current process. */
export function getEvalRegistry(): Map<string, EvalRegistryEntry> {
  return evalRegistry;
}

/**
 * Register an eval definition with the SDK so the runner can discover it
 * after importing the eval module.
 */
export function defineEval<
  TInput = unknown,
  TOutputs extends EvalOutputs = EvalOutputs,
>(definition: EvalDefinition<TInput, TOutputs>): void {
  evalRegistry.set(definition.id, {
    id: definition.id,
    title: definition.title,
    use: (fn) => fn(definition),
  });
}
