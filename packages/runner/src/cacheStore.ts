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
} from '@agent-evals/shared';
import { resultify } from 't-result';

const defaultMaxEntriesPerNamespace = 100;
const cacheSerializationMarker = '__aecs';
const supportedCacheSerializationPrefix = 'v1:';
const externalJsonCacheSerializationMarker = 'v1:ExternalJson';
const externalJsonBlobExtension = '.json.br';
const cacheEntryExtension = '.json.br';
const debugEntryExtension = '.json';

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
}): FsCacheStore {
  const cacheDir = resolve(
    options.workspaceRoot,
    options.dir ?? '.agent-evals/cache',
  );
  const debugDir = resolve(
    options.workspaceRoot,
    options.debugDir ?? '.agent-evals/cache-debug',
  );
  const blobDir = resolve(
    options.workspaceRoot,
    options.blobDir ?? '.agent-evals/cache-blobs',
  );
  const externalJsonStore = createExternalJsonBlobStore(blobDir);
  const defaultMaxEntries = normalizeMaxEntries(options.maxEntriesPerNamespace);

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
      const entry = await readCacheEntry(cacheDir, namespace, keyHash);
      return entry === null
        ? null
        : await materializeExternalJsonCacheEntryOrNull(
            entry,
            externalJsonStore,
          );
    },

    async lookupWithDebug(namespace, keyHash) {
      const rawEntry = await readCacheEntry(cacheDir, namespace, keyHash);
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
      const maxEntries = maxEntriesForNamespace(
        entry.namespace,
        defaultMaxEntries,
        options.maxEntriesByNamespace,
      );

      await withCacheFileLock(
        namespaceLockPath(cacheDir, entry.namespace),
        () => writeCompressedCacheEntry(cacheDir, entry),
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

      await pruneEntriesForNamespace({
        cacheDir,
        debugDir,
        namespace: entry.namespace,
        maxEntries,
        protectedKey: entry.key,
      });
      await pruneExternalJsonBlobs(cacheDir, blobDir);
    },

    async list() {
      const files = await listCacheEntryFiles(cacheDir);
      const items: CacheListItem[] = [];

      for (const filePath of files) {
        const fileEntry = await readCacheEntryFilePath(filePath);
        if (
          fileEntry === null ||
          !entryMatchesPath(filePath, fileEntry.entry)
        ) {
          continue;
        }

        const entry = fileEntry.entry;
        const operationType = entry.operationType ?? 'span';
        const operationName =
          entry.operationName ?? entry.spanName ?? entry.namespace;
        items.push({
          key: entry.key,
          namespace: entry.namespace,
          operationType,
          operationName,
          spanName: entry.spanName,
          spanKind: entry.spanKind,
          storedAt: entry.storedAt,
          sizeBytes: fileEntry.sizeBytes,
        });
      }

      items.sort((a, b) => (a.storedAt < b.storedAt ? 1 : -1));
      return items;
    },

    async clear(filter) {
      if (
        !filter ||
        (filter.namespace === undefined && filter.key === undefined)
      ) {
        await rm(cacheDir, { recursive: true, force: true });
        await rm(debugDir, { recursive: true, force: true });
        await rm(blobDir, { recursive: true, force: true });
        return;
      }

      if (filter.namespace !== undefined) {
        await clearCacheEntries(cacheDir, filter);
        await clearDebugEntries(debugDir, filter);
        await pruneExternalJsonBlobs(cacheDir, blobDir);
        return;
      }

      await clearCacheEntries(cacheDir, filter);
      await clearDebugEntries(debugDir, filter);
      await pruneExternalJsonBlobs(cacheDir, blobDir);
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

function toPendingKey(namespace: string, keyHash: string): string {
  return `${namespace}::${keyHash}`;
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

async function readCacheEntry(
  cacheDir: string,
  namespace: string,
  key: string,
): Promise<CacheEntry | null> {
  const fileEntry = await readCacheEntryFilePath(
    cacheEntryPath(cacheDir, namespace, key),
    { namespace, key },
  );
  return fileEntry?.entry ?? null;
}

async function readCacheEntryFilePath(
  filePath: string,
  expected?: { namespace: string; key: string },
): Promise<{ entry: CacheEntry; sizeBytes: number } | null> {
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
  return { entry, sizeBytes: compressedResult.value.byteLength };
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

async function clearCacheEntries(
  cacheDir: string,
  filter: CacheClearFilter,
): Promise<void> {
  const files =
    filter.namespace === undefined
      ? await listCacheEntryFiles(cacheDir)
      : await listCacheEntryFiles(namespaceDirPath(cacheDir, filter.namespace));
  for (const filePath of files) {
    const fileEntry = await readCacheEntryFilePath(filePath);
    if (fileEntry === null) continue;
    const entry = fileEntry.entry;
    if (!entryMatchesFilter(entry, filter)) continue;
    await withCacheFileLock(namespaceLockPath(cacheDir, entry.namespace), () =>
      rm(filePath, { force: true }),
    );
  }
  if (filter.namespace !== undefined) {
    await removeDirIfEmpty(namespaceDirPath(cacheDir, filter.namespace));
  }
}

async function clearDebugEntries(
  debugDir: string,
  filter: CacheClearFilter,
): Promise<void> {
  const files =
    filter.namespace === undefined
      ? await listDebugEntryFiles(debugDir)
      : await listDebugEntryFiles(namespaceDirPath(debugDir, filter.namespace));
  for (const filePath of files) {
    const entry = await readDebugEntryFilePath(filePath);
    if (entry === null || !entryMatchesFilter(entry, filter)) continue;
    await withCacheFileLock(namespaceLockPath(debugDir, entry.namespace), () =>
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

async function pruneEntriesForNamespace(params: {
  cacheDir: string;
  debugDir: string;
  namespace: string;
  maxEntries: number;
  protectedKey: string;
}): Promise<void> {
  const { cacheDir, debugDir, namespace, maxEntries, protectedKey } = params;
  await withCacheFileLock(namespaceLockPath(cacheDir, namespace), async () => {
    const keptKeys = await pruneCacheEntriesForNamespace(
      cacheDir,
      namespace,
      maxEntries,
      protectedKey,
    );
    await withCacheFileLock(namespaceLockPath(debugDir, namespace), () =>
      pruneDebugEntriesForNamespace(debugDir, namespace, keptKeys),
    );
  });
}

async function pruneCacheEntriesForNamespace(
  cacheDir: string,
  namespace: string,
  maxEntries: number,
  protectedKey: string,
): Promise<Set<string>> {
  const entries = await listCacheEntriesForNamespace(cacheDir, namespace);
  const sorted = entries.toSorted((a, b) =>
    a.entry.storedAt < b.entry.storedAt ? 1 : -1,
  );
  const keptKeys = new Set<string>();
  const protectedEntry = entries.find(
    (item) => item.entry.key === protectedKey,
  );
  if (protectedEntry !== undefined) {
    keptKeys.add(protectedEntry.entry.key);
  }

  for (const item of sorted) {
    if (keptKeys.size >= maxEntries) break;
    keptKeys.add(item.entry.key);
  }

  for (const item of entries) {
    if (!keptKeys.has(item.entry.key)) {
      await rm(item.filePath, { force: true });
    }
  }
  await removeDirIfEmpty(namespaceDirPath(cacheDir, namespace));
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
    const entry = await readDebugEntryFilePath(filePath);
    if (
      entry !== null &&
      entry.namespace === namespace &&
      !keptKeys.has(entry.key)
    ) {
      await rm(filePath, { force: true });
    }
  }
  await removeDirIfEmpty(namespaceDirPath(debugDir, namespace));
}

async function listCacheEntriesForNamespace(
  cacheDir: string,
  namespace: string,
): Promise<Array<{ filePath: string; entry: CacheEntry }>> {
  const files = await listCacheEntryFiles(
    namespaceDirPath(cacheDir, namespace),
  );
  const entries: Array<{ filePath: string; entry: CacheEntry }> = [];
  for (const filePath of files) {
    const fileEntry = await readCacheEntryFilePath(filePath);
    if (
      fileEntry !== null &&
      fileEntry.entry.namespace === namespace &&
      entryMatchesPath(filePath, fileEntry.entry)
    ) {
      entries.push({ filePath, entry: fileEntry.entry });
    }
  }
  return entries;
}

function entryMatchesPath(filePath: string, entry: CacheEntry): boolean {
  return (
    basename(filePath) === `${entry.key}${cacheEntryExtension}` &&
    basename(dirname(filePath)) === sanitizeSegment(entry.namespace)
  );
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

function createExternalJsonBlobStore(
  blobDir: string,
): CacheSerializationExternalJsonStore {
  return {
    async write(rawJson) {
      const rawBytes = Buffer.from(rawJson, 'utf8');
      const hash = hashExternalJson(rawBytes);
      const path = externalJsonBlobPath(hash);
      const compressed = brotliCompressSync(rawBytes);
      const filePath = resolveStorePath(blobDir, path);

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
      const compressed = await readFile(resolveStorePath(blobDir, ref.path));
      const rawBytes = brotliDecompressSync(compressed);
      const rawJson = rawBytes.toString('utf8');
      if (
        rawBytes.byteLength !== ref.length ||
        hashExternalJson(rawBytes) !== ref.hash
      ) {
        throw new Error(
          `External cache blob failed integrity check: ${ref.hash}`,
        );
      }
      return rawJson;
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

async function pruneExternalJsonBlobs(
  cacheDir: string,
  blobDir: string,
): Promise<void> {
  if (!existsSync(blobDir)) return;
  const referenced = await collectReferencedExternalJsonBlobPaths(cacheDir);
  for (const path of await listExternalJsonBlobPaths(blobDir)) {
    if (!referenced.has(path)) {
      await rm(resolveStorePath(blobDir, path), { force: true });
    }
  }
}

async function collectReferencedExternalJsonBlobPaths(
  cacheDir: string,
): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const filePath of await listCacheEntryFiles(cacheDir)) {
    const fileEntry = await readCacheEntryFilePath(filePath);
    if (fileEntry === null || !entryMatchesPath(filePath, fileEntry.entry)) {
      continue;
    }
    collectExternalJsonBlobPaths(fileEntry.entry, paths);
  }
  return paths;
}

function collectExternalJsonBlobPaths(
  value: unknown,
  paths: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectExternalJsonBlobPaths(item, paths);
    return;
  }
  if (!isRecordLike(value)) return;
  if (
    value[cacheSerializationMarker] === externalJsonCacheSerializationMarker &&
    typeof value.path === 'string'
  ) {
    paths.add(value.path);
  }
  for (const entryValue of Object.values(value)) {
    collectExternalJsonBlobPaths(entryValue, paths);
  }
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

async function listCacheEntryFiles(rootDir: string): Promise<string[]> {
  return listFilesWithExtension(rootDir, cacheEntryExtension);
}

async function listDebugEntryFiles(rootDir: string): Promise<string[]> {
  return listFilesWithExtension(rootDir, debugEntryExtension);
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

async function withCacheFileLock(
  filePath: string,
  fn: () => Promise<void>,
): Promise<void> {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  await acquireLock(lockPath);
  const result = await resultify(fn);
  await rm(lockPath, { recursive: true, force: true });
  if (result.error) throw result.error;
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
