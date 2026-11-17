import {
  type ChangedEvals,
  type DiscoveryIssue,
  type EvalSummary,
} from '@agent-evals/shared';
import { createDocumentStore } from 'tsdf';
import { apiClient, getRpcResult, getRpcResultUnwrap } from '#src/api/client';
import { dataStoreManager } from '#src/stores/dataStoreManager';

export const evalSummariesStore = createDocumentStore<EvalSummary[]>({
  id: 'document-eval-summaries',
  storeManager: dataStoreManager,
  usesRealTimeUpdates: true,
  fetchFn: async (signal) => {
    return getRpcResultUnwrap(
      apiClient.api.evals.$get(undefined, { init: { signal } }),
    );
  },
});

export const discoveryIssuesStore = createDocumentStore<DiscoveryIssue[]>({
  id: 'document-discovery-issues',
  storeManager: dataStoreManager,
  usesRealTimeUpdates: true,
  fetchFn: async (signal) => {
    return getRpcResultUnwrap(
      apiClient.api.evals['discovery-issues'].$get(undefined, {
        init: { signal },
      }),
    );
  },
});

/** Evals whose file changed on the current branch versus its base ref. */
export const changedEvalsStore = createDocumentStore<ChangedEvals>({
  id: 'document-changed-evals',
  storeManager: dataStoreManager,
  usesRealTimeUpdates: true,
  fetchFn: async (signal) => {
    return getRpcResultUnwrap(
      apiClient.api.evals.changed.$get(undefined, { init: { signal } }),
    );
  },
});

type EvalInvalidationPriority = Parameters<
  typeof evalSummariesStore.invalidateData
>[0];

export function invalidateEvalSummaries(
  priority?: EvalInvalidationPriority,
): void {
  evalSummariesStore.invalidateData(priority);
}

export function invalidateEvalResources(
  priority?: EvalInvalidationPriority,
): void {
  evalSummariesStore.invalidateData(priority);
  discoveryIssuesStore.invalidateData(priority);
  changedEvalsStore.invalidateData(priority);
}

/** Ask the server to open the eval's source file in the user's editor. */
export async function openEvalInEditor(evalId: string): Promise<void> {
  await getRpcResult(
    apiClient.api.evals[':evalId']['open-in-editor'].$post({
      param: { evalId: encodeURIComponent(evalId) },
    }),
  );
}

/** Mark an eval's latest run fingerprint as current and refresh eval summaries. */
export async function markEvalNotStale(evalId: string): Promise<void> {
  const result = await getRpcResult(
    apiClient.api.evals[':evalId']['mark-not-stale'].$post({
      param: { evalId: encodeURIComponent(evalId) },
    }),
  );
  if (result.error) return;
  invalidateEvalSummaries();
}

/** Mark an eval's latest run fingerprint as mismatched and refresh eval summaries. */
export async function markEvalStale(evalId: string): Promise<void> {
  const result = await getRpcResult(
    apiClient.api.evals[':evalId']['mark-stale'].$post({
      param: { evalId: encodeURIComponent(evalId) },
    }),
  );
  if (result.error) return;
  invalidateEvalSummaries();
}
