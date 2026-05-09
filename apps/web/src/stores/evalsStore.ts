import { type DiscoveryIssue, type EvalSummary } from '@agent-evals/shared';
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
}

/** Ask the server to open the eval's source file in the user's editor. */
export async function openEvalInEditor(evalId: string): Promise<void> {
  await getRpcResult(
    apiClient.api.evals[':evalId']['open-in-editor'].$post({
      param: { evalId: encodeURIComponent(evalId) },
    }),
  );
}
