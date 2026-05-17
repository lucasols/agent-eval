import {
  runInEvalRuntimeScope,
  runWithEvalRegistry,
  type EvalDefinition,
  type EvalOutputs,
  type EvalRegistryEntry,
  type EvalRuntimeScope,
} from '@agent-evals/sdk';
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
