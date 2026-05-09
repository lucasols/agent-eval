import {
  type CaseRow,
  type RunManifest,
  type RunSummary,
} from '@agent-evals/shared';
import { createDocumentStore } from 'tsdf';
import { apiClient, getRpcResultUnwrap } from '#src/api/client';
import { dataStoreManager } from '#src/stores/dataStoreManager';
import { getRunsForEval, runTargetsEval } from '#src/utils/evalRuns';

export type HistoricalRun = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
};

export const runHistoryStore = createDocumentStore<HistoricalRun[]>({
  id: 'document-run-history',
  storeManager: dataStoreManager,
  usesRealTimeUpdates: true,
  fetchFn: async (signal) => {
    const runs = await getRpcResultUnwrap(
      apiClient.api.runs.history.$get(undefined, { init: { signal } }),
    );
    runs.sort(
      (a, b) =>
        new Date(b.manifest.startedAt).getTime() -
        new Date(a.manifest.startedAt).getTime(),
    );
    return runs;
  },
});

type RunHistoryInvalidationPriority = Parameters<
  typeof runHistoryStore.invalidateData
>[0];

export function invalidateRunHistory(
  priority?: RunHistoryInvalidationPriority,
): void {
  runHistoryStore.invalidateData(priority);
}

export { getRunsForEval, runTargetsEval };
