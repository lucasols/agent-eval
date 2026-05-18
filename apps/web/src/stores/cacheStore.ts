import { type CacheEntryWithDebugKey } from '@agent-evals/shared';
import { createCollectionStore } from 'tsdf';
import { apiClient, getRpcResult, getRpcResultUnwrap } from '#src/api/client';
import { dataStoreManager } from '#src/stores/dataStoreManager';

export type CacheEntryPayload = { namespace: string; key: string };

export const cacheEntryStore = createCollectionStore<
  CacheEntryWithDebugKey,
  CacheEntryPayload
>({
  id: 'collection-cache-entries',
  storeManager: dataStoreManager,
  getCollectionItemKey: (payload) => [payload.namespace, payload.key],
  fetchFn: async (payload, signal) => {
    return getRpcResultUnwrap(
      apiClient.api.cache[':namespace'][':key'].$get(
        {
          param: {
            namespace: encodeURIComponent(payload.namespace),
            key: encodeURIComponent(payload.key),
          },
        },
        { init: { signal } },
      ),
    );
  },
});

function getCacheEntryPathParams(
  payload: CacheEntryPayload,
): CacheEntryPayload {
  return {
    namespace: encodeURIComponent(payload.namespace),
    key: encodeURIComponent(payload.key),
  };
}

export async function deleteCacheEntry(
  payload: CacheEntryPayload,
): Promise<string | null> {
  const endMutation = cacheEntryStore.startMutation(payload);
  const result = await getRpcResult(
    apiClient.api.cache[':namespace'][':key'].$delete({
      param: getCacheEntryPathParams(payload),
    }),
  );
  endMutation();

  if (result.error) return result.error.message;
  cacheEntryStore.deleteItemState(payload);
  return null;
}

export async function deleteAllCacheEntries(): Promise<string | null> {
  const result = await getRpcResult(apiClient.api.cache.$delete());

  if (result.error) return result.error.message;
  cacheEntryStore.deleteItemState(() => true);
  return null;
}
