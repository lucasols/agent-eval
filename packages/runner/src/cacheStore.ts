import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import {
  deserializeCacheRecording,
  getRealDateNowMs,
  materializeExternalJsonValues,
} from '@agent-evals/sdk';
import type {
  CacheAdapter,
  CacheDebugKeyWrite,
  CacheSerializationExternalJsonStore,
} from '@agent-evals/sdk';
import {
  cacheDebugKeyEntrySchema,
  cacheEntrySchema,
  cacheRecordingSchema,
  type CacheDebugKeyEntry,
  type CacheEntry,
  type CacheEntryWithDebugKey,
  type CacheListItem,
  type CacheRepairSummary,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import {
  cacheAccessSortTime,
  normalizeLastAccessedAtUpdateIntervalMs,
  shouldRefreshLastAccessedAt,
} from './cacheAccessTime.ts';
import { toPendingKey } from './cacheKeys.ts';

const defaultMaxEntriesPerNamespace = 100;
const cacheSerializationMarker = '__aecs';
const supportedCacheSerializationPrefix = 'v1:';
const externalJsonCacheSerializationMarker = 'v1:ExternalJson';
const externalJsonBlobExtension = '.json.br';
const externalJsonBlobDirName = 'cache-blobs';
const cacheEntryExtension = '.json.br';
const debugEntryExtension = '.json';
const cacheIndexFilePrefix = '.index-';

/** Filter accepted by `FsCacheStore.clear` to narrow the set of entries removed. */
export type CacheClearFilter = { namespace?: string; key?: string };

/** Filesystem cache adapter backing persisted cache entries for a workspace. */
export type FsCacheStore = CacheAdapter & {
  /** Store used for content-addressed external JSON blob values. */
  externalJsonStore: CacheSerializationExternalJsonStore;
  /** Walk the cache directory and return a summary row per stored entry. */
  list(): Promise<CacheListItem[]>;
  /** Return a persisted cache entry with optional raw-key debug metadata. */
  lookupWithDebug(
    namespace: string,
    keyHash: string,
  ): Promise<CacheEntryWithDebugKey | null>;
  /** Delete entries matching `filter`, or all entries when no filter is given. */
  clear(filter?: CacheClearFilter): Promise<void>;
  /** Resolve the on-disk directory used for cache entries. */
  dir(): string;
  /** Resolve the on-disk directory used for raw-key debug entries. */
  debugDir(): string;
  /** Resolve the on-disk directory used for external JSON cache blobs. */
  blobDir(): string;
  pruneExternalJsonBlobs(): Promise<void>;
  /** Apply configured entry retention to indexed namespaces. */
  pruneRetention(): Promise<void>;
  /** Remove files and index rows that are no longer part of the indexed cache. */
  repair(): Promise<CacheRepairSummary>;
};

type CacheIndexEntry = {
  storedAt: string;
  lastAccessedAt: string | null;
  blobRefs: string[];
};

type CacheIndexFile = {
  version: 1;
  namespace: string;
  entries: Record<string, CacheIndexEntry>;
};
export type BufferedCacheStore = CacheAdapter & {
  /** Persist buffered writes into the backing store. */
  commit(): Promise<void>;
  /** Return the entries written during the buffered session. */
  getPendingEntries(): CacheEntry[];
  /** Return the entries and debug metadata written during the buffered session. */
  getPendingWrites(): PendingCacheWrite[];
};

export type PendingCacheWrite = {
  entry: CacheEntry;
  debugKey: CacheDebugKeyWrite | undefined;
};

export async function commitPendingCacheWrites(params: {
  backingStore: CacheAdapter;
  pendingWrites: readonly PendingCacheWrite[];
}): Promise<void> {
  for (const pendingWrite of params.pendingWrites) {
    await params.backingStore.write(pendingWrite.entry, pendingWrite.debugKey);
  }
}

/**
 * Create a filesystem-backed cache adapter rooted at `<workspaceRoot>/<dir>`.
 *
 * Cache entries are stored as one Brotli-compressed JSON file per entry, nested
 * under a sanitized namespace directory. Debug sidecars mirror one key per file
 * and include the authored raw key plus the serialized cache entry.
 */
export function createFsCacheStore(options: {
  workspaceRoot: string;
  dir?: string;
  debugDir?: string;
  blobDir?: string;
  maxEntriesPerNamespace?: number;
  maxEntriesByNamespace?: Record<string, number>;
  lastAccessedAtUpdateIntervalMs?: number;
}): FsCacheStore {
  const cacheDir = resolve(
    options.workspaceRoot,
    options.dir ?? '.agent-evals/cache',
  );
  const debugDir = resolve(
    options.workspaceRoot,
    options.debugDir ?? '.agent-evals/cache-debug',
  );
  const blobDir =
    options.blobDir === undefined
      ? join(cacheDir, externalJsonBlobDirName)
      : resolve(options.workspaceRoot, options.blobDir);
  const legacyBlobDir = resolve(
    options.workspaceRoot,
    '.agent-evals/cache-blobs',
  );
  const fallbackBlobDirs =
    options.blobDir === undefined && legacyBlobDir !== blobDir
      ? [legacyBlobDir]
      : [];
  const blobDirs = [blobDir, ...fallbackBlobDirs];
  const externalJsonStore = createExternalJsonBlobStore({
    fallbackDirs: fallbackBlobDirs,
    primaryDir: blobDir,
  });
  const defaultMaxEntries = normalizeMaxEntries(options.maxEntriesPerNamespace);
  const lastAccessedAtUpdateIntervalMs =
    normalizeLastAccessedAtUpdateIntervalMs(
      options.lastAccessedAtUpdateIntervalMs,
    );

  return {
    externalJsonStore,

    dir() {
      return cacheDir;
    },

    debugDir() {
      return debugDir;
    },

    blobDir() {
      return blobDir;
    },

    async lookup(namespace, keyHash) {
      const entry = await readIndexedCacheEntry({
        cacheDir,
        key: keyHash,
        namespace,
      });
      if (entry === null) return null;
      const materialized = await materializeExternalJsonCacheEntryOrNull(
        entry,
        externalJsonStore,
      );
      if (materialized !== null) {
        await updateCacheIndexLastAccessedAt({
          cacheDir,
          key: keyHash,
          namespace,
          updateIntervalMs: lastAccessedAtUpdateIntervalMs,
        });
      }
      return materialized;
    },

    async lookupWithDebug(namespace, keyHash) {
      const rawEntry = await readIndexedCacheEntry({
        cacheDir,
        key: keyHash,
        namespace,
      });
      if (rawEntry === null) return null;
      const entry = await materializeExternalJsonCacheEntryOrNull(
        rawEntry,
        externalJsonStore,
      );
      if (entry === null) return null;
      const debugKey = await readDebugEntry(debugDir, namespace, keyHash);
      const deserializedEntry: CacheEntry = {
        ...entry,
        recording: deserializeCacheRecording(entry.recording),
      };
      return debugKey === null
        ? deserializedEntry
        : { ...deserializedEntry, debugKey };
    },

    async write(entry, debugKey) {
      await withCacheFileLock(
        namespaceLockPath(cacheDir, entry.namespace),
        async () => {
          await writeCompressedCacheEntry(cacheDir, entry);
          if (!usesSupportedCacheSerialization(entry.recording)) {
            return;
          }
          const index = await readNamespaceIndex(cacheDir, entry.namespace);
          index.entries[entry.key] = {
            storedAt: entry.storedAt,
            lastAccessedAt: entry.storedAt,
            blobRefs: await collectExternalJsonBlobRefs(entry, blobDirs),
          };
          await writeNamespaceIndex(cacheDir, index);
        },
      );

      if (debugKey !== undefined) {
        const debugWriteResult = await resultify(() =>
          writeDebugKeyEntry({ debugDir, entry, debugKey }),
        );
        if (debugWriteResult.error) {
          await resultify(() =>
            clearDebugEntries(debugDir, {
              namespace: entry.namespace,
              key: entry.key,
            }),
          );
        }
      }
    },
    async list() {
      const items: CacheListItem[] = [];
      for (const index of await listCacheIndexes(cacheDir)) {
        for (const [key, entry] of Object.entries(index.entries)) {
          items.push(toCacheListItem(index.namespace, key, entry));
        }
      }

      items.sort((a, b) =>
        cacheAccessSortTime(a) < cacheAccessSortTime(b) ? 1 : -1,
      );
      return items;
    },

    async clear(filter) {
      if (
        !filter ||
        (filter.namespace === undefined && filter.key === undefined)
      ) {
        await rm(cacheDir, { recursive: true, force: true });
        await rm(debugDir, { recursive: true, force: true });
        await Promise.all(
          blobDirs.map((dir) => rm(dir, { recursive: true, force: true })),
        );
        return;
      }

      if (filter.namespace !== undefined) {
        await clearCacheEntries(cacheDir, filter);
        await clearDebugEntries(debugDir, filter);
        await pruneUnreferencedExternalJsonBlobs(cacheDir, blobDirs);
        return;
      }

      await clearCacheEntries(cacheDir, filter);
      await clearDebugEntries(debugDir, filter);
      await pruneUnreferencedExternalJsonBlobs(cacheDir, blobDirs);
    },

    async pruneExternalJsonBlobs() {
      await pruneUnreferencedExternalJsonBlobs(cacheDir, blobDirs);
    },

    async pruneRetention() {
      for (const index_ of await listCacheIndexes(cacheDir)) {
        const namespace = index_.namespace;
        const maxEntries = maxEntriesForNamespace(
          namespace,
          defaultMaxEntries,
          options.maxEntriesByNamespace,
        );
        const keptKeys = await withCacheFileLock(
          namespaceLockPath(cacheDir, namespace),
          async () => {
            const index = await readNamespaceIndex(cacheDir, namespace);
            return pruneCacheEntriesForNamespace({
              cacheDir,
              index,
              maxEntries,
            });
          },
        );
        await withCacheFileLock(namespaceLockPath(debugDir, namespace), () =>
          pruneDebugEntriesForNamespace(debugDir, namespace, keptKeys),
        );
      }
      await pruneUnreferencedExternalJsonBlobs(cacheDir, blobDirs);
    },

    async repair() {
      return repairIndexedCache({ blobDirs, cacheDir, debugDir });
    },
  };
}

/**
 * Create a write-buffered cache adapter for one trial attempt.
 *
 * Lookups first consult entries written earlier in the same trial, then fall
 * back to the shared backing store. Call `commit()` after selecting the
 * winning trial so only that trial's writes reach the shared cache.
 */
export function createBufferedCacheStore(
  backingStore: CacheAdapter,
): BufferedCacheStore {
  const pendingEntries = new Map<
    string,
    { entry: CacheEntry; debugKey: CacheDebugKeyWrite | undefined }
  >();

  return {
    externalJsonStore: backingStore.externalJsonStore,

    async lookup(namespace, keyHash) {
      const buffered = pendingEntries.get(toPendingKey(namespace, keyHash));
      if (buffered !== undefined) {
        return backingStore.externalJsonStore === undefined
          ? buffered.entry
          : await materializeExternalJsonCacheEntryOrNull(
              buffered.entry,
              backingStore.externalJsonStore,
            );
      }
      return backingStore.lookup(namespace, keyHash);
    },

    write(entry, debugKey) {
      pendingEntries.set(toPendingKey(entry.namespace, entry.key), {
        entry,
        debugKey,
      });
      return Promise.resolve();
    },

    async commit() {
      await commitPendingCacheWrites({
        backingStore,
        pendingWrites: [...pendingEntries.values()].map((pending) => ({
          ...pending,
        })),
      });
    },

    getPendingEntries() {
      return [...pendingEntries.values()].map((pending) => pending.entry);
    },

    getPendingWrites() {
      return [...pendingEntries.values()].map((pending) => ({ ...pending }));
    },
  };
}

function normalizeMaxEntries(
  value: number | undefined,
  fallback = defaultMaxEntriesPerNamespace,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function maxEntriesForNamespace(
  namespace: string,
  defaultMaxEntries: number,
  maxEntriesByNamespace: Record<string, number> | undefined,
): number {
  const namespaceMaxEntries = maxEntriesByNamespace?.[namespace];
  return namespaceMaxEntries === undefined
    ? defaultMaxEntries
    : normalizeMaxEntries(namespaceMaxEntries, defaultMaxEntries);
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function namespaceDirPath(rootDir: string, namespace: string): string {
  return join(rootDir, sanitizeSegment(namespace));
}

function namespaceLockPath(rootDir: string, namespace: string): string {
  return join(rootDir, `${sanitizeSegment(namespace)}.namespace`);
}

function cacheEntryPath(
  cacheDir: string,
  namespace: string,
  key: string,
): string {
  return entryPath({
    rootDir: cacheDir,
    namespace,
    key,
    extension: cacheEntryExtension,
  });
}

function debugEntryPath(
  debugDir: string,
  namespace: string,
  key: string,
): string {
  return entryPath({
    rootDir: debugDir,
    namespace,
    key,
    extension: debugEntryExtension,
  });
}

function entryPath(params: {
  rootDir: string;
  namespace: string;
  key: string;
  extension: string;
}): string {
  const namespaceDir = resolve(
    namespaceDirPath(params.rootDir, params.namespace),
  );
  const filePath = resolve(namespaceDir, `${params.key}${params.extension}`);
  if (
    filePath !== namespaceDir &&
    !filePath.startsWith(`${namespaceDir}${sep}`)
  ) {
    throw new Error(
      `Cache entry key escapes namespace directory: ${params.key}`,
    );
  }
  return filePath;
}

function cacheIndexPath(cacheDir: string, namespace: string): string {
  return join(
    namespaceDirPath(cacheDir, namespace),
    `${cacheIndexFilePrefix}${hashNamespace(namespace)}${debugEntryExtension}`,
  );
}

async function readIndexedCacheEntry(params: {
  cacheDir: string;
  namespace: string;
  key: string;
}): Promise<CacheEntry | null> {
  return withCacheFileLock(
    namespaceLockPath(params.cacheDir, params.namespace),
    async () => {
      const index = await readNamespaceIndex(params.cacheDir, params.namespace);
      const indexEntry = index.entries[params.key];
      if (indexEntry === undefined) return null;

      const fileEntry = await readCacheEntryFilePath(
        cacheEntryPath(params.cacheDir, params.namespace, params.key),
        { namespace: params.namespace, key: params.key },
      );
      if (fileEntry === null) return null;
      return fileEntry.entry;
    },
  );
}

async function updateCacheIndexLastAccessedAt(params: {
  cacheDir: string;
  namespace: string;
  key: string;
  updateIntervalMs: number;
}): Promise<void> {
  await withCacheFileLock(
    namespaceLockPath(params.cacheDir, params.namespace),
    async () => {
      const index = await readNamespaceIndex(params.cacheDir, params.namespace);
      const entry = index.entries[params.key];
      if (entry === undefined) return;
      const nowMs = getRealDateNowMs();
      if (
        !shouldRefreshLastAccessedAt({
          lastAccessedAt: entry.lastAccessedAt,
          nowMs,
          updateIntervalMs: params.updateIntervalMs,
        })
      ) {
        return;
      }
      index.entries[params.key] = {
        ...entry,
        lastAccessedAt: new Date(nowMs).toISOString(),
      };
      await writeNamespaceIndex(params.cacheDir, index);
    },
  );
}

async function readCacheEntryFilePath(
  filePath: string,
  expected?: { namespace: string; key: string },
): Promise<{ entry: CacheEntry } | null> {
  if (!existsSync(filePath)) return null;
  const compressedResult = await resultify(() => readFile(filePath));
  if (compressedResult.error) return null;
  const rawResult = resultify(() =>
    brotliDecompressSync(compressedResult.value).toString('utf8'),
  );
  if (rawResult.error) return null;
  const json = safeJsonParse(rawResult.value);
  if (json === null) return null;
  const parsed = cacheEntrySchema.safeParse(json);
  if (!parsed.success) return null;
  const entry = parsed.data;
  if (!usesSupportedCacheSerialization(entry.recording)) return null;
  if (
    expected !== undefined &&
    (entry.namespace !== expected.namespace || entry.key !== expected.key)
  ) {
    return null;
  }
  return { entry };
}

async function writeCompressedCacheEntry(
  cacheDir: string,
  entry: CacheEntry,
): Promise<void> {
  const filePath = cacheEntryPath(cacheDir, entry.namespace, entry.key);
  const rawJson = JSON.stringify(entry);
  const compressed = brotliCompressSync(Buffer.from(rawJson, 'utf8'));
  await writeAtomicFile(filePath, compressed);
}

async function readDebugEntry(
  debugDir: string,
  namespace: string,
  key: string,
): Promise<CacheDebugKeyEntry | null> {
  return readDebugEntryFilePath(debugEntryPath(debugDir, namespace, key), {
    namespace,
    key,
  });
}

async function readDebugEntryFilePath(
  filePath: string,
  expected?: { namespace: string; key: string },
): Promise<CacheDebugKeyEntry | null> {
  if (!existsSync(filePath)) return null;
  const rawResult = await resultify(() => readFile(filePath, 'utf8'));
  if (rawResult.error) return null;
  const json = safeJsonParse(rawResult.value);
  if (json === null) return null;
  const parsed = cacheDebugKeyEntrySchema.safeParse(json);
  if (!parsed.success) return null;
  const entry = parsed.data;
  if (
    entry.entry.namespace !== entry.namespace ||
    entry.entry.key !== entry.key ||
    !usesSupportedCacheSerialization(entry.entry.recording)
  ) {
    return null;
  }
  if (
    expected !== undefined &&
    (entry.namespace !== expected.namespace || entry.key !== expected.key)
  ) {
    return null;
  }
  return entry;
}

async function writeDebugKeyEntry(params: {
  debugDir: string;
  entry: CacheEntry;
  debugKey: CacheDebugKeyWrite;
}): Promise<void> {
  const { debugDir, entry, debugKey } = params;
  const debugEntry: CacheDebugKeyEntry = {
    version: 1,
    key: entry.key,
    namespace: entry.namespace,
    operationType: debugKey.operationType,
    operationName: debugKey.operationName,
    storedAt: entry.storedAt,
    rawKey: debugKey.rawKey,
    entry,
  };

  await withCacheFileLock(namespaceLockPath(debugDir, entry.namespace), () =>
    writePrettyDebugEntry(debugDir, debugEntry),
  );
}

async function writePrettyDebugEntry(
  debugDir: string,
  entry: CacheDebugKeyEntry,
): Promise<void> {
  await writeAtomicFile(
    debugEntryPath(debugDir, entry.namespace, entry.key),
    JSON.stringify(entry, null, 2),
  );
}

async function writeAtomicFile(
  filePath: string,
  contents: string | Buffer,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid.toString()}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, contents);
  await rename(tmpPath, filePath);
}

const emptyCacheIndex = (namespace: string): CacheIndexFile => ({
  version: 1,
  namespace,
  entries: {},
});

async function readNamespaceIndex(
  cacheDir: string,
  namespace: string,
): Promise<CacheIndexFile> {
  const indexPath = cacheIndexPath(cacheDir, namespace);
  if (!existsSync(indexPath)) return emptyCacheIndex(namespace);
  const rawResult = await resultify(() => readFile(indexPath, 'utf8'));
  if (rawResult.error) return emptyCacheIndex(namespace);
  const parsed = parseCacheIndexFile(safeJsonParse(rawResult.value), namespace);
  return parsed ?? emptyCacheIndex(namespace);
}

async function writeNamespaceIndex(
  cacheDir: string,
  index: CacheIndexFile,
): Promise<void> {
  const entries = Object.entries(index.entries);
  if (entries.length === 0) {
    await rm(cacheIndexPath(cacheDir, index.namespace), { force: true });
    await removeDirIfEmpty(namespaceDirPath(cacheDir, index.namespace));
    return;
  }
  const sortedEntries = entries.toSorted(([a], [b]) => (a < b ? -1 : 1));
  const normalizedEntries = Object.fromEntries(
    sortedEntries.map(([key, entry]) => [key, entry]),
  );
  await writeAtomicFile(
    cacheIndexPath(cacheDir, index.namespace),
    JSON.stringify({ ...index, entries: normalizedEntries }, null, 2),
  );
}

async function listCacheIndexes(cacheDir: string): Promise<CacheIndexFile[]> {
  if (!existsSync(cacheDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(cacheDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];
  const records: CacheIndexFile[] = [];
  for (const entry of entriesResult.value) {
    if (!entry.isDirectory()) continue;
    const namespaceDir = join(cacheDir, entry.name);
    for (const indexFilePath of await listCacheIndexFiles(namespaceDir)) {
      const rawResult = await resultify(() => readFile(indexFilePath, 'utf8'));
      if (rawResult.error) continue;
      const parsed = parseCacheIndexFile(safeJsonParse(rawResult.value));
      if (parsed === null) continue;
      records.push(parsed);
    }
  }
  return records;
}

function hashNamespace(namespace: string): string {
  return createHash('sha256').update(namespace).digest('hex');
}

function parseCacheIndexFile(
  value: unknown,
  expectedNamespace?: string,
): CacheIndexFile | null {
  if (!isRecordLike(value)) return null;
  if (value.version !== 1 || typeof value.namespace !== 'string') return null;
  if (
    expectedNamespace !== undefined &&
    value.namespace !== expectedNamespace
  ) {
    return null;
  }
  if (!isRecordLike(value.entries)) return null;
  const entries: Record<string, CacheIndexEntry> = {};
  for (const [key, entryValue] of Object.entries(value.entries)) {
    const entry = parseCacheIndexEntry(entryValue);
    if (entry === null) return null;
    entries[key] = entry;
  }
  return { version: 1, namespace: value.namespace, entries };
}

function parseCacheIndexEntry(value: unknown): CacheIndexEntry | null {
  if (!isRecordLike(value)) return null;
  if (
    typeof value.storedAt !== 'string' ||
    (value.lastAccessedAt !== null && typeof value.lastAccessedAt !== 'string')
  ) {
    return null;
  }
  if (!Array.isArray(value.blobRefs)) return null;
  const blobRefs: string[] = [];
  for (const blobRef of value.blobRefs) {
    if (typeof blobRef !== 'string') return null;
    blobRefs.push(blobRef);
  }
  return {
    storedAt: value.storedAt,
    lastAccessedAt: value.lastAccessedAt,
    blobRefs,
  };
}

function toCacheListItem(
  namespace: string,
  key: string,
  entry: CacheIndexEntry,
): CacheListItem {
  return {
    key,
    namespace,
    storedAt: entry.storedAt,
    lastAccessedAt: entry.lastAccessedAt,
  };
}

function keyFromEntryFilePath(
  filePath: string,
  extension: string,
): string | null {
  const name = basename(filePath);
  if (!name.endsWith(extension)) return null;
  return name.slice(0, -extension.length);
}

function debugNamespaceFromPath(debugDir: string, filePath: string): string {
  return basename(dirname(resolve(debugDir, relative(debugDir, filePath))));
}

async function clearCacheEntries(
  cacheDir: string,
  filter: CacheClearFilter,
): Promise<void> {
  const indexes =
    filter.namespace === undefined
      ? await listCacheIndexes(cacheDir)
      : [await readNamespaceIndex(cacheDir, filter.namespace)];

  for (const record of indexes) {
    const namespace = record.namespace;
    await withCacheFileLock(
      namespaceLockPath(cacheDir, namespace),
      async () => {
        const index = await readNamespaceIndex(cacheDir, namespace);
        const matchingKeys = Object.keys(index.entries).filter((key) => {
          const entry = index.entries[key];
          return (
            entry !== undefined &&
            entryMatchesFilter({ namespace, key }, filter)
          );
        });
        for (const key of matchingKeys) {
          await rm(cacheEntryPath(cacheDir, namespace, key), { force: true });
          delete index.entries[key];
        }
        await writeNamespaceIndex(cacheDir, index);
      },
    );
  }
}

async function clearDebugEntries(
  debugDir: string,
  filter: CacheClearFilter,
): Promise<void> {
  const files = await listDebugEntryFiles(
    filter.namespace === undefined
      ? debugDir
      : namespaceDirPath(debugDir, filter.namespace),
  );
  for (const filePath of files) {
    const namespace =
      filter.namespace === undefined
        ? debugNamespaceFromPath(debugDir, filePath)
        : filter.namespace;
    const key = keyFromEntryFilePath(filePath, debugEntryExtension);
    if (key === null) continue;
    if (!entryMatchesFilter({ namespace, key }, filter)) continue;
    await withCacheFileLock(namespaceLockPath(debugDir, namespace), () =>
      rm(filePath, { force: true }),
    );
  }
  if (filter.namespace !== undefined) {
    await removeDirIfEmpty(namespaceDirPath(debugDir, filter.namespace));
  }
}

function entryMatchesFilter(
  entry: { namespace: string; key: string },
  filter: CacheClearFilter,
): boolean {
  if (filter.namespace !== undefined && entry.namespace !== filter.namespace) {
    return false;
  }
  return filter.key === undefined || entry.key === filter.key;
}

async function pruneCacheEntriesForNamespace(params: {
  cacheDir: string;
  index: CacheIndexFile;
  maxEntries: number;
}): Promise<Set<string>> {
  const { cacheDir, index, maxEntries } = params;
  const entries = Object.entries(index.entries);
  const sorted = entries.toSorted(([, a], [, b]) =>
    cacheAccessSortTime(a) < cacheAccessSortTime(b) ? 1 : -1,
  );
  const keptKeys = new Set<string>();

  for (const [key] of sorted) {
    if (keptKeys.size >= maxEntries) break;
    keptKeys.add(key);
  }

  for (const [key] of entries) {
    if (!keptKeys.has(key)) {
      await rm(cacheEntryPath(cacheDir, index.namespace, key), { force: true });
      delete index.entries[key];
    }
  }
  await writeNamespaceIndex(cacheDir, index);
  return keptKeys;
}

async function pruneDebugEntriesForNamespace(
  debugDir: string,
  namespace: string,
  keptKeys: Set<string>,
): Promise<void> {
  const files = await listDebugEntryFiles(
    namespaceDirPath(debugDir, namespace),
  );
  for (const filePath of files) {
    const key = keyFromEntryFilePath(filePath, debugEntryExtension);
    if (key !== null && !keptKeys.has(key)) {
      await rm(filePath, { force: true });
    }
  }
  await removeDirIfEmpty(namespaceDirPath(debugDir, namespace));
}

async function repairIndexedCache(params: {
  cacheDir: string;
  debugDir: string;
  blobDirs: readonly string[];
}): Promise<CacheRepairSummary> {
  const summary: CacheRepairSummary = {
    removedCacheFiles: 0,
    removedDebugFiles: 0,
    removedBlobFiles: 0,
    removedIndexRows: 0,
    rewrittenIndexes: 0,
  };

  for (const index_ of await listCacheIndexes(params.cacheDir)) {
    const result = await withCacheFileLock(
      namespaceLockPath(params.cacheDir, index_.namespace),
      async () => {
        const index = await readNamespaceIndex(
          params.cacheDir,
          index_.namespace,
        );
        let removedRows = 0;
        for (const key of Object.keys(index.entries)) {
          if (
            !existsSync(cacheEntryPath(params.cacheDir, index.namespace, key))
          ) {
            delete index.entries[key];
            removedRows++;
          }
        }
        if (removedRows === 0) {
          return { removedRows, rewritten: false };
        }
        await writeNamespaceIndex(params.cacheDir, index);
        return { removedRows, rewritten: true };
      },
    );
    summary.removedIndexRows += result.removedRows;
    if (result.rewritten) summary.rewrittenIndexes++;
  }

  const indexes = await listCacheIndexes(params.cacheDir);
  const indexedCacheFiles = new Set<string>();
  const indexedDebugFiles = new Set<string>();
  const indexedBlobRefs = new Set<string>();
  for (const index_ of indexes) {
    for (const [key, entry] of Object.entries(index_.entries)) {
      indexedCacheFiles.add(
        cacheEntryPath(params.cacheDir, index_.namespace, key),
      );
      indexedDebugFiles.add(
        debugEntryPath(params.debugDir, index_.namespace, key),
      );
      for (const blobRef of entry.blobRefs) {
        indexedBlobRefs.add(blobRef);
      }
    }
  }

  for (const filePath of await listCacheEntryFiles(
    params.cacheDir,
    'allNamespaces',
  )) {
    if (!indexedCacheFiles.has(filePath)) {
      await rm(filePath, { force: true });
      summary.removedCacheFiles++;
      await removeDirIfEmpty(dirname(filePath));
    }
  }

  for (const filePath of await listDebugEntryFiles(params.debugDir)) {
    if (!indexedDebugFiles.has(filePath)) {
      await rm(filePath, { force: true });
      summary.removedDebugFiles++;
      await removeDirIfEmpty(dirname(filePath));
    }
  }

  for (const blobDir of params.blobDirs) {
    if (!existsSync(blobDir)) continue;
    for (const blobRef of await listExternalJsonBlobPaths(blobDir)) {
      if (!indexedBlobRefs.has(blobRef)) {
        await rm(resolveStorePath(blobDir, blobRef), { force: true });
        summary.removedBlobFiles++;
      }
    }
  }

  return summary;
}

function usesSupportedCacheSerialization(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(usesSupportedCacheSerialization);
  }
  if (!isRecordLike(value)) return true;
  if (
    Object.hasOwn(value, cacheSerializationMarker) &&
    (typeof value[cacheSerializationMarker] !== 'string' ||
      !value[cacheSerializationMarker].startsWith(
        supportedCacheSerializationPrefix,
      ))
  ) {
    return false;
  }
  return Object.values(value).every(usesSupportedCacheSerialization);
}

function createExternalJsonBlobStore(params: {
  primaryDir: string;
  fallbackDirs: readonly string[];
}): CacheSerializationExternalJsonStore {
  return {
    async write(rawJson) {
      const rawBytes = Buffer.from(rawJson, 'utf8');
      const hash = hashExternalJson(rawBytes);
      const path = externalJsonBlobPath(hash);
      const compressed = brotliCompressSync(rawBytes);
      const filePath = resolveStorePath(params.primaryDir, path);

      if (!existsSync(filePath)) {
        await writeAtomicFile(filePath, compressed);
      }

      return {
        compressedLength: compressed.byteLength,
        hash,
        length: rawBytes.byteLength,
        path,
      };
    },

    async read(ref) {
      for (const dir of [params.primaryDir, ...params.fallbackDirs]) {
        const compressedResult = await resultify(() =>
          readFile(resolveStorePath(dir, ref.path)),
        );
        if (compressedResult.error) continue;
        const rawBytesResult = resultify(() =>
          brotliDecompressSync(compressedResult.value),
        );
        if (rawBytesResult.error) continue;
        const rawBytes = rawBytesResult.value;
        if (
          rawBytes.byteLength === ref.length &&
          hashExternalJson(rawBytes) === ref.hash
        ) {
          return rawBytes.toString('utf8');
        }
      }
      throw new Error(
        `External cache blob failed integrity check: ${ref.hash}`,
      );
    },
  };
}

function hashExternalJson(rawBytes: Buffer): `sha256:${string}` {
  const digest = createHash('sha256').update(rawBytes).digest('hex');
  return `sha256:${digest}`;
}

function externalJsonBlobPath(hash: `sha256:${string}`): string {
  const digest = hash.slice('sha256:'.length);
  return join(
    'sha256',
    digest.slice(0, 2),
    `${digest}${externalJsonBlobExtension}`,
  );
}

function resolveStorePath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`External cache blob path escapes store: ${relativePath}`);
  }
  return path;
}

async function materializeExternalJsonCacheEntry(
  entry: CacheEntry,
  store: CacheSerializationExternalJsonStore,
): Promise<CacheEntry> {
  return {
    ...entry,
    recording: cacheRecordingSchema.parse(
      await materializeExternalJsonValues(entry.recording, store),
    ),
  };
}

async function materializeExternalJsonCacheEntryOrNull(
  entry: CacheEntry,
  store: CacheSerializationExternalJsonStore,
): Promise<CacheEntry | null> {
  const result = await resultify(() =>
    materializeExternalJsonCacheEntry(entry, store),
  );
  return result.error ? null : result.value;
}

async function pruneUnreferencedExternalJsonBlobs(
  cacheDir: string,
  blobDirs: readonly string[],
): Promise<void> {
  const referenced = await collectReferencedExternalJsonBlobPaths(cacheDir);
  for (const blobDir of blobDirs) {
    if (!existsSync(blobDir)) continue;
    for (const path of await listExternalJsonBlobPaths(blobDir)) {
      if (!referenced.has(path)) {
        await rm(resolveStorePath(blobDir, path), { force: true });
      }
    }
  }
}

async function collectReferencedExternalJsonBlobPaths(
  cacheDir: string,
): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const index_ of await listCacheIndexes(cacheDir)) {
    for (const entry of Object.values(index_.entries)) {
      for (const blobRef of entry.blobRefs) {
        paths.add(blobRef);
      }
    }
  }
  return paths;
}

async function collectExternalJsonBlobRefs(
  value: unknown,
  blobDirs: readonly string[],
): Promise<string[]> {
  const paths = new Set<string>();
  const pendingBlobPaths: string[] = [];
  collectExternalJsonBlobPaths(value, paths, pendingBlobPaths);

  while (pendingBlobPaths.length > 0) {
    const blobPath = pendingBlobPaths.pop();
    if (blobPath === undefined) continue;
    const rawJson = await readExternalJsonBlobByPath(blobDirs, blobPath);
    if (rawJson === null) continue;
    const json = safeJsonParse(rawJson);
    if (json === null) continue;
    collectExternalJsonBlobPaths(json, paths, pendingBlobPaths);
  }

  return [...paths].sort();
}

function collectExternalJsonBlobPaths(
  value: unknown,
  paths: Set<string>,
  pendingBlobPaths: string[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExternalJsonBlobPaths(item, paths, pendingBlobPaths);
    }
    return;
  }
  if (!isRecordLike(value)) return;
  if (
    value[cacheSerializationMarker] === externalJsonCacheSerializationMarker &&
    typeof value.path === 'string'
  ) {
    if (!paths.has(value.path)) {
      paths.add(value.path);
      pendingBlobPaths.push(value.path);
    }
  }
  for (const entryValue of Object.values(value)) {
    collectExternalJsonBlobPaths(entryValue, paths, pendingBlobPaths);
  }
}

async function readExternalJsonBlobByPath(
  blobDirs: readonly string[],
  path: string,
): Promise<string | null> {
  for (const blobDir of blobDirs) {
    const compressedResult = await resultify(() =>
      readFile(resolveStorePath(blobDir, path)),
    );
    if (compressedResult.error) continue;
    const rawResult = resultify(() =>
      brotliDecompressSync(compressedResult.value).toString('utf8'),
    );
    if (!rawResult.error) return rawResult.value;
  }
  return null;
}

async function listExternalJsonBlobPaths(blobDir: string): Promise<string[]> {
  const paths: string[] = [];
  await collectExternalJsonBlobFilePaths(blobDir, blobDir, paths);
  return paths;
}

async function collectExternalJsonBlobFilePaths(
  root: string,
  dir: string,
  paths: string[],
): Promise<void> {
  const entriesResult = await resultify(() =>
    readdir(dir, { withFileTypes: true }),
  );
  if (entriesResult.error) return;
  for (const entry of entriesResult.value) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectExternalJsonBlobFilePaths(root, path, paths);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(externalJsonBlobExtension)) {
      paths.push(relative(root, path));
    }
  }
}

async function listCacheEntryFiles(
  rootDir: string,
  scope: 'allNamespaces' | 'namespace',
): Promise<string[]> {
  if (scope === 'namespace') {
    return listDirectFilesWithExtension(rootDir, cacheEntryExtension);
  }

  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];

  const files: string[] = [];
  for (const entry of entriesResult.value) {
    if (!entry.isDirectory()) continue;
    files.push(
      ...(await listDirectFilesWithExtension(
        join(rootDir, entry.name),
        cacheEntryExtension,
      )),
    );
  }
  return files;
}

async function listDebugEntryFiles(rootDir: string): Promise<string[]> {
  return listFilesWithExtension(rootDir, debugEntryExtension);
}

async function listCacheIndexFiles(rootDir: string): Promise<string[]> {
  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];
  return entriesResult.value
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(cacheIndexFilePrefix) &&
        entry.name.endsWith(debugEntryExtension),
    )
    .map((entry) => join(rootDir, entry.name));
}

async function listDirectFilesWithExtension(
  rootDir: string,
  extension: string,
): Promise<string[]> {
  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];
  return entriesResult.value
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(rootDir, entry.name));
}

async function listFilesWithExtension(
  rootDir: string,
  extension: string,
): Promise<string[]> {
  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];
  const files: string[] = [];
  for (const entry of entriesResult.value) {
    const filePath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesWithExtension(filePath, extension)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(filePath);
    }
  }
  return files;
}

async function removeDirIfEmpty(dirPath: string): Promise<void> {
  const entriesResult = await resultify(() => readdir(dirPath));
  if (entriesResult.error || entriesResult.value.length > 0) return;
  await rm(dirPath, { recursive: true, force: true });
}

async function withCacheFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  await acquireLock(lockPath);
  const result = await resultify(fn);
  await rm(lockPath, { recursive: true, force: true });
  if (result.error) throw result.error;
  return result.value;
}

async function acquireLock(lockPath: string): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 5000) {
    const result = await resultify(() => mkdir(lockPath, { recursive: false }));
    if (!result.error) return;
    lastError = result.error;
    await sleep(20);
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`Timed out acquiring cache lock at ${lockPath}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function safeJsonParse(text: string): unknown {
  const parsed = resultify((): unknown => JSON.parse(text));
  if (parsed.error) return null;
  return parsed.value;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
