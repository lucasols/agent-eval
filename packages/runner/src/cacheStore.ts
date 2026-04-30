import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deserializeCacheRecording } from '@agent-evals/sdk';
import type { CacheAdapter, CacheDebugKeyWrite } from '@agent-evals/sdk';
import {
  cacheDebugKeyFileSchema,
  cacheFileSchema,
  type CacheDebugKeyEntry,
  type CacheDebugKeyFile,
  type CacheEntry,
  type CacheEntryWithDebugKey,
  type CacheFile,
  type CacheListItem,
} from '@agent-evals/shared';
import { resultify } from 't-result';

const defaultMaxEntriesPerNamespace = 100;
const cacheSerializationMarker = '__agentEvalsCacheSerialization';
const supportedCacheSerializationVersion = 'json-safe-v1';

/** Filter accepted by `FsCacheStore.clear` to narrow the set of entries removed. */
export type CacheClearFilter = { namespace?: string; key?: string };

/** Filesystem cache adapter backing persisted cache entries for a workspace. */
export type FsCacheStore = CacheAdapter & {
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
};

export type BufferedCacheStore = CacheAdapter & {
  /** Persist buffered writes into the backing store. */
  commit(): Promise<void>;
  /** Return the entries written during the buffered session. */
  getPendingEntries(): CacheEntry[];
};

/**
 * Create a filesystem-backed cache adapter rooted at `<workspaceRoot>/<dir>`.
 *
 * Cache entries are grouped into one inspectable JSON file per cache owner.
 * Writes use a short-lived lock directory plus `<name>.tmp` + atomic
 * `rename` to avoid partial reads and lost updates under concurrent access.
 */
export function createFsCacheStore(options: {
  workspaceRoot: string;
  dir?: string;
  debugDir?: string;
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
  const defaultMaxEntries = normalizeMaxEntries(options.maxEntriesPerNamespace);

  return {
    dir() {
      return cacheDir;
    },

    debugDir() {
      return debugDir;
    },

    async lookup(namespace, keyHash) {
      const owner = ownerFromNamespace(namespace);
      const cacheFile = await readCacheFile(cacheDir, owner);
      return cacheFile?.entries[keyHash] ?? null;
    },

    async lookupWithDebug(namespace, keyHash) {
      const owner = ownerFromNamespace(namespace);
      const cacheFile = await readCacheFile(cacheDir, owner);
      const entry = cacheFile?.entries[keyHash] ?? null;
      if (entry === null) return null;
      const debugFile = await readDebugKeyFile(debugDir, owner);
      const debugKey = debugFile?.entries[keyHash];
      const deserializedEntry: CacheEntry = {
        ...entry,
        recording: deserializeCacheRecording(entry.recording),
      };
      return debugKey === undefined
        ? deserializedEntry
        : { ...deserializedEntry, debugKey };
    },

    async write(entry, debugKey) {
      const owner = ownerFromNamespace(entry.namespace);
      const filePath = ownerPath(cacheDir, owner);
      await mkdir(cacheDir, { recursive: true });
      await withCacheFileLock(filePath, async () => {
        const existing = await readCacheFile(cacheDir, owner);
        const entries = existing?.entries ?? {};
        const prunedEntries = pruneEntries(
          { ...entries, [entry.key]: entry },
          entry.namespace,
          maxEntriesForNamespace(
            entry.namespace,
            defaultMaxEntries,
            options.maxEntriesByNamespace,
          ),
          entry.key,
        );
        await writeCacheFile(cacheDir, {
          version: 1,
          owner,
          entries: prunedEntries,
        });
      });

      if (debugKey !== undefined) {
        const debugWriteResult = await resultify(() =>
          writeDebugKeyEntry({
            debugDir,
            entry,
            debugKey,
            maxEntries: maxEntriesForNamespace(
              entry.namespace,
              defaultMaxEntries,
              options.maxEntriesByNamespace,
            ),
          }),
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
      if (!existsSync(cacheDir)) return [];
      const files = await readdir(cacheDir);
      const items: CacheListItem[] = [];

      for (const fileName of files) {
        if (!fileName.endsWith('.json')) continue;
        const filePath = join(cacheDir, fileName);
        const fileStatResult = await resultify(() => stat(filePath));
        if (fileStatResult.error || !fileStatResult.value.isFile()) continue;

        const cacheFile = await readCacheFilePath(filePath);
        if (cacheFile === null) continue;

        for (const entry of Object.values(cacheFile.entries)) {
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
            codeFingerprint: entry.codeFingerprint,
            sizeBytes: Buffer.byteLength(JSON.stringify(entry), 'utf8'),
          });
        }
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
        return;
      }

      if (filter.namespace !== undefined) {
        const owner = ownerFromNamespace(filter.namespace);
        const filePath = ownerPath(cacheDir, owner);
        if (existsSync(cacheDir)) {
          await withCacheFileLock(filePath, async () => {
            const cacheFile = await readCacheFile(cacheDir, owner);
            if (cacheFile === null) return;

            const entries = Object.fromEntries(
              Object.entries(cacheFile.entries).filter(([key, entry]) => {
                if (filter.key !== undefined) {
                  return key !== filter.key;
                }
                return entry.namespace !== filter.namespace;
              }),
            );
            await writeOrRemoveCacheFile(cacheDir, {
              version: 1,
              owner,
              entries,
            });
          });
        }
        await clearDebugEntries(debugDir, filter);
        return;
      }

      if (existsSync(cacheDir)) {
        const files = await readdir(cacheDir);
        for (const fileName of files) {
          if (!fileName.endsWith('.json')) continue;
          const filePath = join(cacheDir, fileName);
          await withCacheFileLock(filePath, async () => {
            const cacheFile = await readCacheFilePath(filePath);
            if (cacheFile === null) return;

            const entries = Object.fromEntries(
              Object.entries(cacheFile.entries).filter(
                ([key]) => key !== filter.key,
              ),
            );
            await writeOrRemoveCacheFile(cacheDir, {
              version: 1,
              owner: cacheFile.owner,
              entries,
            });
          });
        }
      }
      await clearDebugEntries(debugDir, filter);
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
    async lookup(namespace, keyHash) {
      const buffered = pendingEntries.get(toPendingKey(namespace, keyHash));
      if (buffered !== undefined) return buffered.entry;
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
      for (const pending of pendingEntries.values()) {
        await backingStore.write(pending.entry, pending.debugKey);
      }
    },

    getPendingEntries() {
      return [...pendingEntries.values()].map((pending) => pending.entry);
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

function ownerFromNamespace(namespace: string): string {
  const [owner] = namespace.split('__');
  return owner === undefined || owner.length === 0 ? namespace : owner;
}

function ownerPath(cacheDir: string, owner: string): string {
  return join(cacheDir, `${sanitizeSegment(owner)}.json`);
}

function toPendingKey(namespace: string, keyHash: string): string {
  return `${namespace}::${keyHash}`;
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

async function readCacheFile(
  cacheDir: string,
  owner: string,
): Promise<CacheFile | null> {
  return readCacheFilePath(ownerPath(cacheDir, owner));
}

async function readCacheFilePath(filePath: string): Promise<CacheFile | null> {
  if (!existsSync(filePath)) return null;
  const rawResult = await resultify(() => readFile(filePath, 'utf-8'));
  if (rawResult.error) return null;
  const json = safeJsonParse(rawResult.value);
  if (json === null) return null;
  const parsed = cacheFileSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    entries: Object.fromEntries(
      Object.entries(parsed.data.entries).filter(([, entry]) =>
        usesSupportedCacheSerialization(entry.recording),
      ),
    ),
  };
}

function usesSupportedCacheSerialization(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(usesSupportedCacheSerialization);
  }
  if (!isRecordLike(value)) return true;
  if (
    Object.hasOwn(value, cacheSerializationMarker) &&
    value[cacheSerializationMarker] !== supportedCacheSerializationVersion
  ) {
    return false;
  }
  return Object.values(value).every(usesSupportedCacheSerialization);
}

async function writeOrRemoveCacheFile(
  cacheDir: string,
  cacheFile: CacheFile,
): Promise<void> {
  if (Object.keys(cacheFile.entries).length === 0) {
    await rm(ownerPath(cacheDir, cacheFile.owner), { force: true });
    return;
  }
  await writeCacheFile(cacheDir, cacheFile);
}

async function writeCacheFile(
  cacheDir: string,
  cacheFile: CacheFile,
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const filePath = ownerPath(cacheDir, cacheFile.owner);
  const tmpPath = `${filePath}.${process.pid.toString()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(cacheFile, null, 2));
  await rename(tmpPath, filePath);
}

async function readDebugKeyFile(
  debugDir: string,
  owner: string,
): Promise<CacheDebugKeyFile | null> {
  return readDebugKeyFilePath(ownerPath(debugDir, owner));
}

async function readDebugKeyFilePath(
  filePath: string,
): Promise<CacheDebugKeyFile | null> {
  if (!existsSync(filePath)) return null;
  const rawResult = await resultify(() => readFile(filePath, 'utf-8'));
  if (rawResult.error) return null;
  const json = safeJsonParse(rawResult.value);
  if (json === null) return null;
  const parsed = cacheDebugKeyFileSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

async function writeDebugKeyEntry(params: {
  debugDir: string;
  entry: CacheEntry;
  debugKey: CacheDebugKeyWrite;
  maxEntries: number;
}): Promise<void> {
  const { debugDir, entry, debugKey, maxEntries } = params;
  const owner = ownerFromNamespace(entry.namespace);
  const filePath = ownerPath(debugDir, owner);
  await mkdir(debugDir, { recursive: true });
  await withCacheFileLock(filePath, async () => {
    const existing = await readDebugKeyFile(debugDir, owner);
    const entries = existing?.entries ?? {};
    const debugEntry: CacheDebugKeyEntry = {
      version: 1,
      key: entry.key,
      namespace: entry.namespace,
      operationType: debugKey.operationType,
      operationName: debugKey.operationName,
      storedAt: entry.storedAt,
      codeFingerprint: debugKey.codeFingerprint,
      rawKey: debugKey.rawKey,
    };
    const prunedEntries = pruneDebugKeyEntries(
      { ...entries, [entry.key]: debugEntry },
      entry.namespace,
      maxEntries,
      entry.key,
    );
    await writeDebugKeyFile(debugDir, {
      version: 1,
      owner,
      entries: prunedEntries,
    });
  });
}

async function clearDebugEntries(
  debugDir: string,
  filter: CacheClearFilter,
): Promise<void> {
  if (!existsSync(debugDir)) return;

  if (filter.namespace !== undefined) {
    const owner = ownerFromNamespace(filter.namespace);
    const filePath = ownerPath(debugDir, owner);
    await withCacheFileLock(filePath, async () => {
      const debugFile = await readDebugKeyFile(debugDir, owner);
      if (debugFile === null) return;

      const entries = Object.fromEntries(
        Object.entries(debugFile.entries).filter(([key, entry]) => {
          if (filter.key !== undefined) {
            return key !== filter.key;
          }
          return entry.namespace !== filter.namespace;
        }),
      );
      await writeOrRemoveDebugKeyFile(debugDir, { version: 1, owner, entries });
    });
    return;
  }

  const files = await readdir(debugDir);
  for (const fileName of files) {
    if (!fileName.endsWith('.json')) continue;
    const filePath = join(debugDir, fileName);
    await withCacheFileLock(filePath, async () => {
      const debugFile = await readDebugKeyFilePath(filePath);
      if (debugFile === null) return;

      const entries = Object.fromEntries(
        Object.entries(debugFile.entries).filter(([key]) => key !== filter.key),
      );
      await writeOrRemoveDebugKeyFile(debugDir, {
        version: 1,
        owner: debugFile.owner,
        entries,
      });
    });
  }
}

async function writeOrRemoveDebugKeyFile(
  debugDir: string,
  debugFile: CacheDebugKeyFile,
): Promise<void> {
  if (Object.keys(debugFile.entries).length === 0) {
    await rm(ownerPath(debugDir, debugFile.owner), { force: true });
    return;
  }
  await writeDebugKeyFile(debugDir, debugFile);
}

async function writeDebugKeyFile(
  debugDir: string,
  debugFile: CacheDebugKeyFile,
): Promise<void> {
  await mkdir(debugDir, { recursive: true });
  const filePath = ownerPath(debugDir, debugFile.owner);
  const tmpPath = `${filePath}.${process.pid.toString()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(debugFile, null, 2));
  await rename(tmpPath, filePath);
}

function pruneEntries(
  entries: Record<string, CacheEntry>,
  namespace: string,
  maxEntries: number,
  protectedKey: string,
): Record<string, CacheEntry> {
  const sorted = Object.values(entries)
    .filter((entry) => entry.namespace === namespace)
    .toSorted((a, b) => (a.storedAt < b.storedAt ? 1 : -1));
  const kept = new Map<string, CacheEntry>();
  const protectedEntry = entries[protectedKey];
  if (protectedEntry?.namespace === namespace) {
    kept.set(protectedEntry.key, protectedEntry);
  }

  for (const entry of sorted) {
    if (kept.size >= maxEntries) break;
    kept.set(entry.key, entry);
  }

  return Object.fromEntries(
    Object.values(entries)
      .filter((entry) => entry.namespace !== namespace || kept.has(entry.key))
      .toSorted((a, b) => (a.key < b.key ? -1 : 1))
      .map((entry) => [entry.key, entry]),
  );
}

function pruneDebugKeyEntries(
  entries: Record<string, CacheDebugKeyEntry>,
  namespace: string,
  maxEntries: number,
  protectedKey: string,
): Record<string, CacheDebugKeyEntry> {
  const sorted = Object.values(entries)
    .filter((entry) => entry.namespace === namespace)
    .toSorted((a, b) => (a.storedAt < b.storedAt ? 1 : -1));
  const kept = new Map<string, CacheDebugKeyEntry>();
  const protectedEntry = entries[protectedKey];
  if (protectedEntry?.namespace === namespace) {
    kept.set(protectedEntry.key, protectedEntry);
  }

  for (const entry of sorted) {
    if (kept.size >= maxEntries) break;
    kept.set(entry.key, entry);
  }

  return Object.fromEntries(
    Object.values(entries)
      .filter((entry) => entry.namespace !== namespace || kept.has(entry.key))
      .toSorted((a, b) => (a.key < b.key ? -1 : 1))
      .map((entry) => [entry.key, entry]),
  );
}

async function withCacheFileLock(
  filePath: string,
  fn: () => Promise<void>,
): Promise<void> {
  const lockPath = `${filePath}.lock`;
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
