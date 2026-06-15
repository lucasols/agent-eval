import { cacheAccessSortTime } from './cacheAccessTime.ts';

const defaultMaxBytesPerNamespace = 3 * 1024 * 1024;

export type CacheRetentionIndexEntry = {
  storedAt: string;
  lastAccessedAt: string | null;
  blobRefs: string[];
};

export type CacheRetentionIndex = {
  namespace: string;
  entries: Record<string, CacheRetentionIndexEntry>;
};

type CacheRetentionEntry = {
  namespace: string;
  key: string;
  storedAt: string;
  lastAccessedAt: string | null;
  cacheBytes: number;
  debugBytes: number;
  blobRefs: string[];
};

type CacheRetentionSortEntry = Pick<
  CacheRetentionEntry,
  'key' | 'lastAccessedAt' | 'namespace' | 'storedAt'
>;

export function normalizeMaxBytes(
  value: number | undefined,
  fallback = defaultMaxBytesPerNamespace,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function maxBytesForNamespace(
  namespace: string,
  defaultMaxBytes: number,
  maxBytesByNamespace: Record<string, number> | undefined,
): number {
  const namespaceMaxBytes = maxBytesByNamespace?.[namespace];
  return namespaceMaxBytes === undefined
    ? defaultMaxBytes
    : normalizeMaxBytes(namespaceMaxBytes, defaultMaxBytes);
}

export async function pruneCacheEntriesByMaxBytes(params: {
  indexes: readonly CacheRetentionIndex[];
  maxBytesForNamespace: (namespace: string) => number;
  cacheEntryBytes: (namespace: string, key: string) => Promise<number>;
  debugEntryBytes: (namespace: string, key: string) => Promise<number>;
  externalJsonBlobBytes: (blobRef: string) => Promise<number>;
  removeEntries: (namespace: string, keys: Set<string>) => Promise<void>;
}): Promise<void> {
  for (const index of params.indexes) {
    const retentionState = await getCacheRetentionState({ ...params, index });
    const maxBytes = params.maxBytesForNamespace(index.namespace);
    if (retentionState.totalBytes <= maxBytes) continue;

    const removedKeys = new Set<string>();
    let totalBytes = retentionState.totalBytes;

    for (const entry of retentionState.entries.toSorted(compareOldestFirst)) {
      if (totalBytes <= maxBytes) break;

      removedKeys.add(entry.key);

      totalBytes -= entry.cacheBytes + entry.debugBytes;
      for (const blobRef of new Set(entry.blobRefs)) {
        const remainingRefs =
          (retentionState.remainingBlobRefCounts.get(blobRef) ?? 0) - 1;
        if (remainingRefs <= 0) {
          retentionState.remainingBlobRefCounts.delete(blobRef);
          totalBytes -= retentionState.blobSizes.get(blobRef) ?? 0;
        } else {
          retentionState.remainingBlobRefCounts.set(blobRef, remainingRefs);
        }
      }
    }

    await params.removeEntries(index.namespace, removedKeys);
  }
}

async function getCacheRetentionState(params: {
  index: CacheRetentionIndex;
  cacheEntryBytes: (namespace: string, key: string) => Promise<number>;
  debugEntryBytes: (namespace: string, key: string) => Promise<number>;
  externalJsonBlobBytes: (blobRef: string) => Promise<number>;
}): Promise<{
  entries: CacheRetentionEntry[];
  totalBytes: number;
  remainingBlobRefCounts: Map<string, number>;
  blobSizes: Map<string, number>;
}> {
  const entries: CacheRetentionEntry[] = [];
  const remainingBlobRefCounts = new Map<string, number>();
  let totalBytes = 0;

  for (const [key, entry] of Object.entries(params.index.entries)) {
    const cacheBytes = await params.cacheEntryBytes(
      params.index.namespace,
      key,
    );
    const debugBytes = await params.debugEntryBytes(
      params.index.namespace,
      key,
    );
    totalBytes += cacheBytes + debugBytes;

    const blobRefs = [...new Set(entry.blobRefs)].sort();
    for (const blobRef of blobRefs) {
      remainingBlobRefCounts.set(
        blobRef,
        (remainingBlobRefCounts.get(blobRef) ?? 0) + 1,
      );
    }

    entries.push({
      key,
      namespace: params.index.namespace,
      storedAt: entry.storedAt,
      lastAccessedAt: entry.lastAccessedAt,
      cacheBytes,
      debugBytes,
      blobRefs,
    });
  }

  const blobSizes = new Map<string, number>();
  for (const blobRef of remainingBlobRefCounts.keys()) {
    const blobBytes = await params.externalJsonBlobBytes(blobRef);
    blobSizes.set(blobRef, blobBytes);
    totalBytes += blobBytes;
  }

  return { blobSizes, entries, remainingBlobRefCounts, totalBytes };
}

function compareOldestFirst(
  a: CacheRetentionSortEntry,
  b: CacheRetentionSortEntry,
): number {
  const aAccess = cacheAccessSortTime(a);
  const bAccess = cacheAccessSortTime(b);
  if (aAccess < bAccess) return -1;
  if (aAccess > bAccess) return 1;
  if (a.namespace < b.namespace) return -1;
  if (a.namespace > b.namespace) return 1;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}
