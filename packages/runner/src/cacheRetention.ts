import { cacheAccessSortTime } from './cacheAccessTime.ts';

const defaultMaxBytesPerNamespace = 3 * 1024 * 1024;
const defaultOldRunMaxAgeMs = 15 * 24 * 60 * 60 * 1000;

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

export type CacheRetentionRunReference = {
  namespace: string;
  key: string;
  evalExists: boolean;
  latestRunForEval: boolean;
  runStartedAt: string;
};

export type CacheRetentionRemovedEntry = CacheRetentionEntry & {
  maxBytes: number;
  namespaceTotalBytes: number;
  reason: 'nonExistingEval' | 'oldRun' | 'retentionLimit';
};

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

export function normalizeOldRunMaxAgeMs(
  value: number | undefined,
  fallback = defaultOldRunMaxAgeMs,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export async function pruneCacheEntriesByMaxBytes(params: {
  indexes: readonly CacheRetentionIndex[];
  runReferences?: readonly CacheRetentionRunReference[];
  oldRunMaxAgeMs?: number;
  nowMs?: number;
  maxBytesForNamespace: (namespace: string) => number;
  cacheEntryBytes: (namespace: string, key: string) => Promise<number>;
  debugEntryBytes: (namespace: string, key: string) => Promise<number>;
  externalJsonBlobBytes: (blobRef: string) => Promise<number>;
  removeEntries: (namespace: string, keys: Set<string>) => Promise<void>;
}): Promise<CacheRetentionRemovedEntry[]> {
  const removedEntries: CacheRetentionRemovedEntry[] = [];
  const runReferencesByEntry = groupRunReferencesByEntry(
    params.runReferences ?? [],
  );
  const oldRunMaxAgeMs = normalizeOldRunMaxAgeMs(params.oldRunMaxAgeMs);
  const nowMs =
    params.nowMs === undefined || !Number.isFinite(params.nowMs)
      ? Date.now()
      : params.nowMs;

  for (const index of params.indexes) {
    const retentionState = await getCacheRetentionState({ ...params, index });
    const maxBytes = params.maxBytesForNamespace(index.namespace);

    const removedKeys = new Set<string>();
    let totalBytes = retentionState.totalBytes;

    const removeEntry = (
      entry: CacheRetentionEntry,
      reason: CacheRetentionRemovedEntry['reason'],
    ) => {
      if (removedKeys.has(entry.key)) return;

      removedKeys.add(entry.key);
      removedEntries.push({
        ...entry,
        maxBytes,
        namespaceTotalBytes: retentionState.totalBytes,
        reason,
      });

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
    };

    for (const entry of retentionState.entries) {
      const references = runReferencesByEntry.get(toEntryId(entry)) ?? [];
      if (references.length === 0) continue;
      if (references.some((reference) => reference.latestRunForEval)) continue;
      if (!references.some((reference) => reference.evalExists)) {
        removeEntry(entry, 'nonExistingEval');
        continue;
      }

      const newestRunTime = newestRunReferenceTime(references);
      if (
        newestRunTime !== null &&
        nowMs - newestRunTime >= oldRunMaxAgeMs
      ) {
        removeEntry(entry, 'oldRun');
      }
    }

    if (totalBytes > maxBytes) {
      for (const entry of retentionState.entries.toSorted((a, b) =>
        compareRetentionCandidate(
          {
            entry: a,
            references: runReferencesByEntry.get(toEntryId(a)) ?? [],
          },
          {
            entry: b,
            references: runReferencesByEntry.get(toEntryId(b)) ?? [],
          },
        ),
      )) {
        if (totalBytes <= maxBytes) break;
        if (removedKeys.has(entry.key)) continue;

        const references = runReferencesByEntry.get(toEntryId(entry)) ?? [];
        if (references.some((reference) => reference.latestRunForEval)) {
          continue;
        }

        removeEntry(entry, 'retentionLimit');
      }
    }

    if (removedKeys.size > 0) {
      await params.removeEntries(index.namespace, removedKeys);
    }
  }

  return removedEntries;
}

function groupRunReferencesByEntry(
  references: readonly CacheRetentionRunReference[],
): Map<string, CacheRetentionRunReference[]> {
  const grouped = new Map<string, CacheRetentionRunReference[]>();
  for (const reference of references) {
    const key = toEntryId(reference);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, [reference]);
    } else {
      existing.push(reference);
    }
  }
  return grouped;
}

function compareRetentionCandidate(
  a: {
    entry: CacheRetentionEntry;
    references: readonly CacheRetentionRunReference[];
  },
  b: {
    entry: CacheRetentionEntry;
    references: readonly CacheRetentionRunReference[];
  },
): number {
  const aNewestRunTime = newestRunReferenceTime(a.references);
  const bNewestRunTime = newestRunReferenceTime(b.references);
  if (aNewestRunTime !== null && bNewestRunTime !== null) {
    if (aNewestRunTime < bNewestRunTime) return -1;
    if (aNewestRunTime > bNewestRunTime) return 1;
  } else if (aNewestRunTime !== null) {
    return -1;
  } else if (bNewestRunTime !== null) {
    return 1;
  }

  return compareOldestFirst(a.entry, b.entry);
}

function newestRunReferenceTime(
  references: readonly CacheRetentionRunReference[],
): number | null {
  let newest: number | null = null;
  for (const reference of references) {
    const time = Date.parse(reference.runStartedAt);
    if (!Number.isFinite(time)) continue;
    if (newest === null || time > newest) newest = time;
  }
  return newest;
}

function toEntryId(entry: { namespace: string; key: string }): string {
  return `${entry.namespace}\u0000${entry.key}`;
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
