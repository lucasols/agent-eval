import {
  runInEvalRuntimeScope,
  runWithEvalRegistry,
  type EvalDefinition,
  type EvalOutputs,
  type EvalRegistryEntry,
  type EvalRuntimeScope,
} from '@agent-evals/sdk';
import { resultify } from 't-result';
import { loadEvalModule } from './evalModuleLoader.ts';
import {
  runWithModuleIsolation,
  type ModuleIsolationContext,
} from './moduleIsolation.ts';

type LoadIsolatedEvalRegistryParams = {
  evalFilePath: string;
  sourceFingerprint: string | undefined;
  moduleIsolation: ModuleIsolationContext;
  runtimeScope: EvalRuntimeScope;
};

type UseIsolatedEvalDefinitionParams<TResult> =
  LoadIsolatedEvalRegistryParams & {
    evalId: string;
    use: <TInput, TOutputs extends EvalOutputs>(
      evalDef: EvalDefinition<TInput, TOutputs>,
    ) => Promise<TResult>;
  };

export async function loadIsolatedEvalRegistry(
  params: LoadIsolatedEvalRegistryParams,
): Promise<Map<string, EvalRegistryEntry>> {
  return await runWithEvalRegistry(async (registry) => {
    await runWithModuleIsolation(params.moduleIsolation, async () => {
      await runInEvalRuntimeScope(params.runtimeScope, async () => {
        await loadEvalModule(params.evalFilePath, params.sourceFingerprint);
      });
    });
    return registry;
  });
}

/**
 * Discovery registries keyed by eval file path and source fingerprint.
 * Process-wide because Node's ESM module cache is process-wide too.
 */
const discoveryRegistries = new Map<string, Map<string, EvalRegistryEntry>>();

/**
 * Load one eval file's registry for discovery, reusing the registry from an
 * earlier discovery of the same file source.
 *
 * Discovery imports use a stable isolation key plus the source fingerprint,
 * so re-importing unchanged (or reverted) source hits Node's ESM cache and
 * never re-runs `defineEval(...)`. Without this cache the registry would come
 * back empty and watcher refreshes would drop tags, columns, and other loaded
 * metadata. Returns `undefined` when the module fails to load so callers can
 * fall back to statically parsed metadata.
 */
export async function loadDiscoveryEvalRegistry(params: {
  evalFilePath: string;
  sourceFingerprint: string;
  moduleIsolation: ModuleIsolationContext;
}): Promise<Map<string, EvalRegistryEntry> | undefined> {
  const cacheKey = `${params.evalFilePath}\0${params.sourceFingerprint}`;
  const cachedRegistry = discoveryRegistries.get(cacheKey);
  if (cachedRegistry !== undefined) return cachedRegistry;

  const loaded = await resultify(() =>
    loadIsolatedEvalRegistry({ ...params, runtimeScope: 'env' }),
  );
  if (loaded.error) return undefined;
  discoveryRegistries.set(cacheKey, loaded.value);
  return loaded.value;
}

export async function useIsolatedEvalDefinition<TResult>(
  params: UseIsolatedEvalDefinitionParams<TResult>,
): Promise<TResult> {
  const registry = await loadIsolatedEvalRegistry(params);
  const entry = registry.get(params.evalId);
  if (entry === undefined) {
    throw new Error(
      `Eval "${params.evalId}" was not registered after importing ${params.evalFilePath}`,
    );
  }

  return await entry.use(async (evalDef) => {
    return await params.use(evalDef);
  });
}
