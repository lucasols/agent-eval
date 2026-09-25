import { join } from 'node:path';
import { getCaseRowCaseKey } from '@agent-evals/shared';
import { resultify } from 't-result';
import { pruneBranchCache } from './branchCachePrune.ts';
import type { FsCacheStore } from './cacheStore.ts';
import type { RunState } from './runOrchestration.ts';
import {
  loadPersistedCaseDetail,
  loadPersistedRunSnapshots,
} from './runPersistence.ts';

/**
 * Prune branch-added cache for the cases completed by this run before its
 * terminal state is published. Keeps other cases' cache, including shared
 * entries. Bypassed, cancelled, and errored cases cannot supersede cache.
 * Missing Git/base metadata or another active run skips cleanup; cleanup
 * errors never change the eval result.
 */
export async function pruneCompletedRunCache(params: {
  workspaceRoot: string;
  cacheStore: FsCacheStore;
  configuredBaseRef: string | undefined;
  runState: RunState;
}): Promise<void> {
  const { runState } = params;
  if (runState.manifest.cacheMode === 'bypass') return;
  const caseKeys = new Set(
    runState.cases
      .filter((row) => row.status === 'pass' || row.status === 'fail')
      .map(getCaseRowCaseKey),
  );
  if (caseKeys.size === 0) return;

  const pruned = await resultify(async () => {
    const history = (
      await loadPersistedRunSnapshots(
        join(params.workspaceRoot, '.agent-evals'),
      )
    ).filter((run) => run.manifest.id !== runState.manifest.id);
    // A first run cannot have superseded any of these cases' cache entries.
    if (
      !history.some((run) =>
        run.cases.some((row) => caseKeys.has(getCaseRowCaseKey(row))),
      )
    )
      return;
    await pruneBranchCache({
      workspaceRoot: params.workspaceRoot,
      cacheStore: params.cacheStore,
      configuredBaseRef: params.configuredBaseRef,
      runs: [...history, runState],
      caseKeys,
      options: { baseRef: undefined, dryRun: false },
      hydrateCaseDetail(run, row) {
        const key = getCaseRowCaseKey(row);
        const collides = run.cases.some(
          (other) =>
            other.caseId === row.caseId && getCaseRowCaseKey(other) !== key,
        );
        return (
          run.caseDetails.get(key) ??
          loadPersistedCaseDetail(run.runDir, collides ? key : row.caseId) ??
          undefined
        );
      },
    });
  });
  if (pruned.error) {
    console.error(
      `[agent-evals] Automatic branch cache cleanup skipped: ${pruned.error.message}`,
    );
  }
}
