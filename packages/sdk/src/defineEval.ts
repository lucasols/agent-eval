import { AsyncLocalStorage } from 'node:async_hooks';
import type { EvalDefinition, EvalOutputs } from './types.ts';

/**
 * Registered eval metadata tracked by the SDK during module loading.
 *
 * Consumers usually access these entries through `getEvalRegistry()`.
 */
export type EvalRegistryEntry = {
  /** Stable eval identifier authored in `defineEval(...)`. */
  id: string;
  /** Optional human-readable eval name. */
  title?: string;
  /** Optional short summary describing what the eval covers. */
  description?: string;
  /**
   * Id of the authored `defineEval(...)` this entry was split from when the
   * definition sets `casesAsEvals: true`. `undefined` for regular evals.
   */
  parentEvalId: string | undefined;
  /** Read the registered definition without erasing its input/output generics. */
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
 *
 * With `casesAsEvals: true`, each case is registered as its own eval with id
 * `<id>/<case id>` and title `<title> / <case id>`, sharing every other
 * setting of the definition. The authored `id` itself is not registered.
 */
export function defineEval<
  TInput = unknown,
  TOutputs extends EvalOutputs = EvalOutputs,
>(definition: EvalDefinition<TInput, TOutputs>): void {
  assertManualScoreDescriptions(definition);
  const registry = getEvalRegistry();

  if (!definition.casesAsEvals) {
    registry.set(definition.id, {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      parentEvalId: undefined,
      use: (fn) => fn(definition),
    });
    return;
  }

  const caseEvalIds = new Set<string>();
  for (const evalCase of definition.cases) {
    const caseEvalId = `${definition.id}/${evalCase.id}`;
    if (caseEvalIds.has(caseEvalId)) {
      throw new Error(
        `Eval "${definition.id}" with casesAsEvals produces duplicate eval id "${caseEvalId}". Case ids must be unique.`,
      );
    }
    caseEvalIds.add(caseEvalId);
    const caseEvalDef: EvalDefinition<TInput, TOutputs> = {
      ...definition,
      id: caseEvalId,
      title: `${definition.title ?? definition.id} / ${evalCase.id}`,
      casesAsEvals: false,
      cases: [evalCase],
    };
    registry.set(caseEvalId, {
      id: caseEvalId,
      title: caseEvalDef.title,
      description: definition.description,
      parentEvalId: definition.id,
      use: (fn) => fn(caseEvalDef),
    });
  }
}

function assertManualScoreDescriptions<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
>(definition: EvalDefinition<TInput, TOutputs>): void {
  for (const [scoreKey, scoreDef] of Object.entries(
    definition.manualScores ?? {},
  )) {
    const candidate: { description?: unknown } = scoreDef;
    const description = candidate.description;
    if (typeof description === 'string' && description.trim() !== '') {
      continue;
    }
    throw new Error(
      `Manual score "${scoreKey}" in eval "${definition.id}" must declare a non-empty description explaining what reviewers should inspect.`,
    );
  }
}
