import type { CreateRunRequest, RunManifest } from '@agent-evals/shared';

/** Build the exact-key run target persisted in run history. */
export function buildPersistedRunTarget(params: {
  target: CreateRunRequest['target'];
  evalKeys: string[];
}): RunManifest['target'] {
  const { target, evalKeys } = params;
  if (target.mode === 'all') return { mode: 'all' };

  const persistEvalKeys =
    (target.evalKeys?.length ?? 0) > 0 ||
    (target.evalIds?.length ?? 0) > 0 ||
    (target.files?.length ?? 0) > 0;
  const keyedTarget = {
    mode: target.mode,
    evalKeys: persistEvalKeys && evalKeys.length > 0 ? evalKeys : undefined,
    files: target.files,
    tagsFilter: target.tagsFilter,
  };

  if (target.mode === 'caseIds') {
    return { ...keyedTarget, caseIds: target.caseIds };
  }
  return keyedTarget;
}
