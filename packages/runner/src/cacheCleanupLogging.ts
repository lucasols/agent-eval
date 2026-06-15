import type { CacheRetentionRemovedEntry } from './cacheRetention.ts';

export type CacheCleanupEntry = { namespace: string; key: string };

export type ExternalJsonBlobFile = {
  blobDir: string;
  path: string;
  filePath: string;
};

type CacheClearReasonInput = {
  namespace?: string;
  key?: string;
  reason?: string;
};

export function filterSelectsEntries(
  filter: CacheClearReasonInput | undefined,
): boolean {
  return filter?.namespace !== undefined || filter?.key !== undefined;
}

export function cacheClearReason(
  filter: CacheClearReasonInput | undefined,
): string {
  if (filter?.reason !== undefined && filter.reason.trim().length > 0) {
    return filter.reason.trim();
  }
  if (filter?.namespace !== undefined && filter.key !== undefined) {
    return `cache clear requested for namespace ${quoteLogValue(
      filter.namespace,
    )} and key ${quoteLogValue(filter.key)}`;
  }
  if (filter?.namespace !== undefined) {
    return `cache clear requested for namespace ${quoteLogValue(
      filter.namespace,
    )}`;
  }
  if (filter?.key !== undefined) {
    return `cache clear requested for key ${quoteLogValue(filter.key)}`;
  }
  return 'cache clear requested for all entries';
}

export function cacheRetentionReason(
  entry: CacheRetentionRemovedEntry,
): string {
  return `retention limit exceeded for namespace ${quoteLogValue(
    entry.namespace,
  )} (${String(entry.namespaceTotalBytes)} bytes > ${String(
    entry.maxBytes,
  )} bytes); pruning least-recently-accessed entries`;
}

export function externalJsonBlobPruneReason(parentReason: string): string {
  return `external JSON blob became unreferenced after ${parentReason}`;
}

export function logRemovedCacheEntries(
  entries: readonly CacheCleanupEntry[],
  reason: string,
): void {
  for (const entry of entries) {
    logRemovedCacheEntry(entry, reason);
  }
}

export function logRemovedCacheEntry(
  entry: CacheCleanupEntry,
  reason: string,
  details?: string,
): void {
  console.error(
    `[agent-evals] Cache cleanup dropped cache entry namespace=${quoteLogValue(
      entry.namespace,
    )} key=${quoteLogValue(entry.key)}${formatLogDetails(
      details,
    )} because ${reason}.`,
  );
}

export function logRemovedCacheIndexRow(
  entry: CacheCleanupEntry,
  reason: string,
): void {
  console.error(
    `[agent-evals] Cache cleanup dropped cache index row namespace=${quoteLogValue(
      entry.namespace,
    )} key=${quoteLogValue(entry.key)} because ${reason}.`,
  );
}

export function logRemovedCacheFiles(
  label: string,
  filePaths: readonly string[],
  reason: string,
): void {
  for (const filePath of filePaths) {
    logRemovedCacheFile(label, filePath, reason);
  }
}

export function logRemovedCacheFile(
  label: string,
  filePath: string,
  reason: string,
): void {
  console.error(
    `[agent-evals] Cache cleanup dropped ${label} path=${quoteLogValue(
      filePath,
    )} because ${reason}.`,
  );
}

export function logRemovedExternalJsonBlobs(
  blobs: readonly ExternalJsonBlobFile[],
  reason: string,
): void {
  for (const blob of blobs) {
    logRemovedExternalJsonBlob(blob, reason);
  }
}

export function logRemovedExternalJsonBlob(
  blob: ExternalJsonBlobFile,
  reason: string,
): void {
  console.error(
    `[agent-evals] Cache cleanup dropped external JSON blob path=${quoteLogValue(
      blob.path,
    )} file=${quoteLogValue(blob.filePath)} because ${reason}.`,
  );
}

export function compareCacheCleanupEntry(
  a: CacheCleanupEntry,
  b: CacheCleanupEntry,
): number {
  if (a.namespace < b.namespace) return -1;
  if (a.namespace > b.namespace) return 1;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

export function compareExternalJsonBlobFile(
  a: ExternalJsonBlobFile,
  b: ExternalJsonBlobFile,
): number {
  if (a.filePath < b.filePath) return -1;
  if (a.filePath > b.filePath) return 1;
  return 0;
}

function quoteLogValue(value: string): string {
  return JSON.stringify(value);
}

function formatLogDetails(details: string | undefined): string {
  return details === undefined ? '' : ` (${details})`;
}
