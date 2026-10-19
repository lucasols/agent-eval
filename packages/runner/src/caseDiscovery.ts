import {
  runInEvalRuntimeScope,
  runWithEvalClock,
  type EvalRegistryEntry,
} from '@agent-evals/sdk';
import { resultify } from 't-result';
import {
  runWithModuleIsolation,
  type ModuleIsolationContext,
} from './moduleIsolation.ts';
import { resolveRunnableEvalCases } from './runExecution.ts';

/**
 * Resolve the case ids an eval runs straight from its definition, so
 * discovery does not depend on past runs. Async `cases` loaders run in the
 * `'cases'` runtime scope with the eval clock, like they do during a run.
 * Returns `undefined` when the eval is not registered, declares both `cases`
 * and `manualInput`, or its `cases` loader throws.
 */
export async function discoverEvalCaseIds(params: {
  entry: EvalRegistryEntry | undefined;
  evalId: string;
  moduleIsolation: ModuleIsolationContext;
}): Promise<string[] | undefined> {
  const { entry, evalId } = params;
  if (entry === undefined) return undefined;

  const caseIds = await resultify(() =>
    runWithModuleIsolation(params.moduleIsolation, () =>
      runInEvalRuntimeScope('cases', () =>
        entry.use(async (evalDef): Promise<string[] | undefined> => {
          if (evalDef.manualInput) {
            return evalDef.cases === undefined
              ? [`${evalId}-manual`]
              : undefined;
          }

          const cases = await runWithEvalClock(
            evalDef.startTime,
            async () =>
              typeof evalDef.cases === 'function'
                ? await evalDef.cases()
                : (evalDef.cases ?? []),
            { freezeTime: evalDef.freezeTime },
          );
          return resolveRunnableEvalCases({ cases, evalId }).map(
            (evalCase) => evalCase.id,
          );
        }),
      ),
    ),
  );
  return caseIds.ok ? caseIds.value : undefined;
}
