import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import {
  getRealDateNowMs,
  runWithEvalClock,
  serializeCacheRecording,
} from '@agent-evals/sdk';
import {
  cacheDebugKeyEntrySchema,
  cacheEntrySchema,
  type CacheDebugKeyEntry,
  type CacheEntry,
} from '@agent-evals/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import { createBufferedCacheStore, createFsCacheStore } from './cacheStore.ts';

const workspaces: string[] = [];
const externalJsonBlobPathRegex = /^sha256\/[a-f0-9]{2}\/[a-f0-9]+\.json\.br$/;
const defaultNamespace = 'debug-eval.expensive-op';
const cacheIndexSchema = z.object({
  version: z.literal(1),
  namespace: z.string(),
  entries: z.record(
    z.string(),
    z
      .object({
        storedAt: z.string(),
        lastAccessedAt: z.string(),
        blobRefs: z.array(z.string()),
      })
      .strict(),
  ),
});

afterEach(async () => {
  await Promise.all(
    workspaces.map((workspacePath) =>
      rm(workspacePath, { recursive: true, force: true }),
    ),
  );
  workspaces.length = 0;
});

async function createWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-evals-cache-'));
  workspaces.push(workspacePath);
  return workspacePath;
}

function cacheEntry(params: {
  key: string;
  namespace?: string;
  storedAt?: string;
}): CacheEntry {
  return {
    version: 1,
    key: params.key,
    namespace: params.namespace ?? defaultNamespace,
    operationType: 'span',
    operationName: 'expensive-op',
    spanName: 'expensive-op',
    spanKind: 'llm',
    storedAt: params.storedAt ?? '2026-04-29T00:00:00.000Z',
    recording: { returnValue: { ok: true }, finalAttributes: {}, ops: [] },
  };
}

async function readCacheEntry(
  workspacePath: string,
  key: string,
  namespace = defaultNamespace,
): Promise<CacheEntry> {
  const compressed = await readFile(
    cacheEntryPath(workspacePath, namespace, key),
  );
  return cacheEntrySchema.parse(
    JSON.parse(brotliDecompressSync(compressed).toString('utf8')),
  );
}

async function readDebugKeyEntry(
  workspacePath: string,
  key: string,
  namespace = defaultNamespace,
): Promise<CacheDebugKeyEntry> {
  return cacheDebugKeyEntrySchema.parse(
    JSON.parse(
      await readFile(debugEntryPath(workspacePath, namespace, key), 'utf8'),
    ),
  );
}

async function readCacheKeys(
  workspacePath: string,
  namespace = defaultNamespace,
): Promise<string[]> {
  const dir = resolve(
    workspacePath,
    '.agent-evals/cache',
    sanitizeSegment(namespace),
  );
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith('.json.br'))
    .map((file) => file.slice(0, -'.json.br'.length))
    .sort();
}

async function readCacheIndex(
  workspacePath: string,
  namespace = defaultNamespace,
): Promise<z.infer<typeof cacheIndexSchema>> {
  const dir = resolve(
    workspacePath,
    '.agent-evals/cache',
    sanitizeSegment(namespace),
  );
  const files = (await readdir(dir)).filter(
    (file) => file.startsWith('.index-') && file.endsWith('.json'),
  );
  expect(files).toHaveLength(1);
  const file = files[0];
  if (file === undefined) throw new Error('Expected one cache index file');
  return cacheIndexSchema.parse(
    JSON.parse(await readFile(resolve(dir, file), 'utf8')),
  );
}

async function readDebugKeys(
  workspacePath: string,
  namespace = defaultNamespace,
): Promise<string[]> {
  const dir = resolve(
    workspacePath,
    '.agent-evals/cache-debug',
    sanitizeSegment(namespace),
  );
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
}

function cacheEntryPath(
  workspacePath: string,
  namespace: string,
  key: string,
): string {
  return resolve(
    workspacePath,
    '.agent-evals/cache',
    sanitizeSegment(namespace),
    `${key}.json.br`,
  );
}

function debugEntryPath(
  workspacePath: string,
  namespace: string,
  key: string,
): string {
  return resolve(
    workspacePath,
    '.agent-evals/cache-debug',
    sanitizeSegment(namespace),
    `${key}.json`,
  );
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function getNestedExternalJsonRef(value: unknown): Record<string, unknown> {
  const payload = getRecordProperty(value, 'payload');
  const rows = getRecordProperty(payload, 'rows');
  if (!isRecordLike(rows)) {
    throw new Error('Expected nested rows to be an external JSON ref');
  }
  return rows;
}

function getStringProperty(value: unknown, key: string): string {
  const property = getRecordProperty(value, key);
  if (typeof property !== 'string') {
    throw new Error(`Expected ${key} to be a string`);
  }
  return property;
}

async function readExternalJsonBlob(
  store: ReturnType<typeof createFsCacheStore>,
  path: string,
): Promise<unknown> {
  return JSON.parse(
    brotliDecompressSync(
      await readFile(resolve(store.blobDir(), path)),
    ).toString('utf8'),
  );
}

function getRecordProperty(value: unknown, key: string): unknown {
  if (!isRecordLike(value)) return undefined;
  return value[key];
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('filesystem cache store raw-key debug storage', () => {
  test('stores normal entries hash-only and raw keys in the debug folder', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const entry = cacheEntry({ key: 'hashed-key' });

    await store.write(entry, {
      rawKey: { prompt: 'refund please', model: 'gpt-4o-mini' },
      operationType: 'span',
      operationName: 'expensive-op',
    });

    const cacheFile = await readCacheEntry(workspacePath, 'hashed-key');
    expect(cacheFile).toMatchObject({
      key: 'hashed-key',
      namespace: defaultNamespace,
    });
    expect(JSON.stringify(cacheFile)).not.toContain('refund please');

    const debugFile = await readDebugKeyEntry(workspacePath, 'hashed-key');
    expect(debugFile).toMatchObject({
      key: 'hashed-key',
      namespace: defaultNamespace,
      operationType: 'span',
      operationName: 'expensive-op',
      rawKey: { prompt: 'refund please', model: 'gpt-4o-mini' },
      entry: cacheFile,
    });

    await expect(
      store.lookup(defaultNamespace, 'hashed-key'),
    ).resolves.toMatchObject({ key: 'hashed-key' });
    await expect(
      store.lookupWithDebug(defaultNamespace, 'hashed-key'),
    ).resolves.toMatchObject({
      key: 'hashed-key',
      debugKey: { rawKey: { prompt: 'refund please' } },
    });
  });

  test('writes cache entries as Brotli-compressed single-entry files', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(cacheEntry({ key: 'hashed-key' }));

    const entryPath = cacheEntryPath(
      workspacePath,
      defaultNamespace,
      'hashed-key',
    );
    expect(existsSync(entryPath)).toBe(true);
    expect(await readCacheEntry(workspacePath, 'hashed-key')).toMatchObject({
      key: 'hashed-key',
      namespace: defaultNamespace,
    });
  });

  test('writes minimal namespace index rows', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(
      cacheEntry({ key: 'hashed-key', storedAt: '2026-04-29T00:00:00.000Z' }),
    );

    await expect(readCacheIndex(workspacePath)).resolves.toEqual({
      version: 1,
      namespace: defaultNamespace,
      entries: {
        'hashed-key': {
          storedAt: '2026-04-29T00:00:00.000Z',
          lastAccessedAt: '2026-04-29T00:00:00.000Z',
          blobRefs: [],
        },
      },
    });
  });

  test('lists entries from the index without reading cache payload files', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    await store.write(
      cacheEntry({ key: 'hashed-key', storedAt: '2026-04-29T00:00:00.000Z' }),
    );
    await writeFile(
      cacheEntryPath(workspacePath, defaultNamespace, 'hashed-key'),
      'not brotli json',
    );

    await expect(store.list()).resolves.toMatchObject([
      {
        key: 'hashed-key',
        namespace: defaultNamespace,
        storedAt: '2026-04-29T00:00:00.000Z',
        lastAccessedAt: '2026-04-29T00:00:00.000Z',
      },
    ]);
    await expect(
      store.lookup(defaultNamespace, 'hashed-key'),
    ).resolves.toBeNull();
  });

  test('prunes by last access time instead of stored time', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({
      maxEntriesPerNamespace: 2,
      workspaceRoot: workspacePath,
    });

    await store.write(
      cacheEntry({ key: 'first', storedAt: '2026-04-29T00:00:00.000Z' }),
    );
    await store.write(
      cacheEntry({ key: 'second', storedAt: '2026-04-29T00:00:01.000Z' }),
    );
    await expect(
      store.lookup(defaultNamespace, 'first'),
    ).resolves.toMatchObject({ key: 'first' });
    await store.write(
      cacheEntry({ key: 'third', storedAt: '2026-04-29T00:00:02.000Z' }),
    );
    await store.pruneRetention();

    expect(await readCacheKeys(workspacePath)).toEqual(['first', 'third']);
    await expect(store.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'first' }),
        expect.objectContaining({ key: 'third' }),
      ]),
    );
  });

  test('cache hits update last access time from the real host clock', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(
      cacheEntry({ key: 'hashed-key', storedAt: '2026-04-29T00:00:00.000Z' }),
    );

    const beforeLookup = new Date(getRealDateNowMs()).toISOString();
    await runWithEvalClock(
      '2020-01-01T00:00:00.000Z',
      async () => {
        await expect(
          store.lookup(defaultNamespace, 'hashed-key'),
        ).resolves.toMatchObject({ key: 'hashed-key' });
      },
      { freezeTime: true },
    );
    const afterLookup = new Date(getRealDateNowMs()).toISOString();

    const items = await store.list();
    expect(items).toHaveLength(1);
    const item = items[0];
    if (item === undefined) throw new Error('Expected one cache list item');
    expect(item.lastAccessedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(item.lastAccessedAt >= beforeLookup).toBe(true);
    expect(item.lastAccessedAt <= afterLookup).toBe(true);
  });

  test('writes raw-key debug files with two-space indentation', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(cacheEntry({ key: 'hashed-key' }), {
      rawKey: { prompt: 'refund please', model: 'gpt-4o-mini' },
      operationType: 'span',
      operationName: 'expensive-op',
    });

    const rawDebugFile = await readFile(
      debugEntryPath(workspacePath, defaultNamespace, 'hashed-key'),
      'utf8',
    );
    expect(rawDebugFile).toContain('\n  "version": 1,');
    expect(rawDebugFile).toContain('\n  "key": "hashed-key",');
    expect(rawDebugFile).toContain('\n  "rawKey": {');
    expect(rawDebugFile).toContain('\n  "entry": {');
  });

  test('stores external JSON blobs under the cache directory by default', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    expect(store.blobDir()).toBe(
      resolve(workspacePath, '.agent-evals/cache/cache-blobs'),
    );
  });

  test('stores large nested JSON values as hashed Brotli blobs', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const rows = Array.from({ length: 160 }, (_, index) => ({
      index,
      message: 'repeatable nested tree payload',
      status: index % 2 === 0 ? 'pass' : 'fail',
    }));
    const entry = cacheEntry({ key: 'hashed-key' });
    entry.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: store.externalJsonStore },
    );

    await store.write(entry);

    const cacheFile = await readCacheEntry(workspacePath, 'hashed-key');
    const blobRef = getNestedExternalJsonRef(cacheFile.recording.returnValue);
    expect(blobRef).toMatchObject({ __aecs: 'v1:ExternalJson' });

    const blobPath = getStringProperty(blobRef, 'path');
    expect(blobPath).toMatch(externalJsonBlobPathRegex);
    const compressed = await readFile(resolve(store.blobDir(), blobPath));
    expect(
      JSON.parse(brotliDecompressSync(compressed).toString('utf8')),
    ).toEqual(rows);

    await expect(
      store.lookup(defaultNamespace, 'hashed-key'),
    ).resolves.toMatchObject({
      recording: { returnValue: { payload: { rows } } },
    });

    await store.clear({ key: 'hashed-key', namespace: defaultNamespace });

    expect(existsSync(resolve(store.blobDir(), blobPath))).toBe(false);
  });

  test('treats entries with missing external JSON blobs as cache misses', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const rows = Array.from({ length: 160 }, (_, index) => ({
      index,
      message: 'repeatable nested tree payload',
      status: index % 2 === 0 ? 'pass' : 'fail',
    }));
    const entry = cacheEntry({ key: 'hashed-key' });
    entry.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: store.externalJsonStore },
    );

    await store.write(entry, {
      rawKey: { prompt: 'serializable' },
      operationType: 'span',
      operationName: 'expensive-op',
    });

    const cacheFile = await readCacheEntry(workspacePath, 'hashed-key');
    const blobRef = getNestedExternalJsonRef(cacheFile.recording.returnValue);
    const blobPath = getStringProperty(blobRef, 'path');
    await rm(resolve(store.blobDir(), blobPath), { force: true });

    await expect(
      store.lookup(defaultNamespace, 'hashed-key'),
    ).resolves.toBeNull();
    await expect(
      store.lookupWithDebug(defaultNamespace, 'hashed-key'),
    ).resolves.toBeNull();
  });

  test('reuses the same external blob path for identical nested JSON', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const rows = Array.from({ length: 160 }, (_, index) => ({
      index,
      message: 'repeatable nested tree payload',
      status: index % 2 === 0 ? 'pass' : 'fail',
    }));
    const first = cacheEntry({ key: 'first' });
    const second = cacheEntry({ key: 'second' });
    first.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: store.externalJsonStore },
    );
    second.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: store.externalJsonStore },
    );

    await store.write(first);
    await store.write(second);

    const firstEntry = await readCacheEntry(workspacePath, 'first');
    const secondEntry = await readCacheEntry(workspacePath, 'second');
    const firstRef = getNestedExternalJsonRef(firstEntry.recording.returnValue);
    const secondRef = getNestedExternalJsonRef(
      secondEntry.recording.returnValue,
    );

    expect(getStringProperty(firstRef, 'hash')).toBe(
      getStringProperty(secondRef, 'hash'),
    );
    expect(getStringProperty(firstRef, 'path')).toBe(
      getStringProperty(secondRef, 'path'),
    );
  });

  test('does not prune external blobs while buffered writes are pending', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const buffered = createBufferedCacheStore(store);
    const rows = Array.from({ length: 160 }, (_, index) => ({
      index,
      message: 'repeatable nested tree payload',
      status: index % 2 === 0 ? 'pass' : 'fail',
    }));
    const pendingEntry = cacheEntry({ key: 'pending-key' });
    pendingEntry.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: buffered.externalJsonStore },
    );

    await buffered.write(pendingEntry);

    const pendingBlobRef = getNestedExternalJsonRef(
      pendingEntry.recording.returnValue,
    );
    const pendingBlobPath = getStringProperty(pendingBlobRef, 'path');
    await store.write(cacheEntry({ key: 'committed-key' }));

    expect(existsSync(resolve(store.blobDir(), pendingBlobPath))).toBe(true);

    await buffered.commit();

    await expect(
      store.lookup(defaultNamespace, 'pending-key'),
    ).resolves.toMatchObject({
      recording: { returnValue: { payload: { rows } } },
    });
  });

  test('reads external blobs from the legacy default blob directory', async () => {
    const workspacePath = await createWorkspace();
    const legacyStore = createFsCacheStore({
      workspaceRoot: workspacePath,
      blobDir: '.agent-evals/cache-blobs',
    });
    const defaultStore = createFsCacheStore({ workspaceRoot: workspacePath });
    const rows = Array.from({ length: 160 }, (_, index) => ({
      index,
      message: 'repeatable nested tree payload',
      status: index % 2 === 0 ? 'pass' : 'fail',
    }));
    const entry = cacheEntry({ key: 'legacy-key' });
    entry.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: legacyStore.externalJsonStore },
    );

    await legacyStore.write(entry);

    await expect(
      defaultStore.lookup(defaultNamespace, 'legacy-key'),
    ).resolves.toMatchObject({
      recording: { returnValue: { payload: { rows } } },
    });
  });

  test('prunes unreferenced external blobs when explicitly requested', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const buffered = createBufferedCacheStore(store);
    const rows = Array.from({ length: 160 }, (_, index) => ({
      index,
      message: 'repeatable nested tree payload',
      status: index % 2 === 0 ? 'pass' : 'fail',
    }));
    const pendingEntry = cacheEntry({ key: 'losing-key' });
    pendingEntry.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: buffered.externalJsonStore },
    );

    await buffered.write(pendingEntry);

    const pendingBlobRef = getNestedExternalJsonRef(
      pendingEntry.recording.returnValue,
    );
    const pendingBlobPath = getStringProperty(pendingBlobRef, 'path');

    await store.pruneExternalJsonBlobs();

    expect(existsSync(resolve(store.blobDir(), pendingBlobPath))).toBe(false);
  });

  test('keeps external blobs referenced from other external blobs', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const child = 'nested payload '.repeat(2_000);
    const payload: Record<string, string> = Object.fromEntries(
      Array.from({ length: 1_200 }, (_, index) => [
        `field${String(index)}`,
        `label ${String(index)}`,
      ]),
    );
    payload.child = child;
    const entry = cacheEntry({ key: 'nested-blob-key' });
    entry.recording = await serializeCacheRecording(
      { returnValue: { payload }, finalAttributes: {}, ops: [] },
      { externalJsonStore: store.externalJsonStore },
    );
    const payloadRef = getRecordProperty(
      entry.recording.returnValue,
      'payload',
    );
    const payloadBlobPath = getStringProperty(payloadRef, 'path');
    const payloadBlob = await readExternalJsonBlob(store, payloadBlobPath);
    const childRef = getRecordProperty(payloadBlob, 'child');
    const childBlobPath = getStringProperty(childRef, 'path');

    await store.write(entry);
    await store.pruneExternalJsonBlobs();

    expect(existsSync(resolve(store.blobDir(), payloadBlobPath))).toBe(true);
    expect(existsSync(resolve(store.blobDir(), childBlobPath))).toBe(true);
    await expect(
      store.lookup(defaultNamespace, 'nested-blob-key'),
    ).resolves.toMatchObject({ recording: { returnValue: { payload } } });
  });

  test('lookup succeeds when raw-key debug data is unavailable', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(cacheEntry({ key: 'hashed-key' }));

    await expect(
      store.lookupWithDebug(defaultNamespace, 'hashed-key'),
    ).resolves.toMatchObject({ key: 'hashed-key' });
    await expect(
      store.lookupWithDebug(defaultNamespace, 'hashed-key'),
    ).resolves.not.toHaveProperty('debugKey');
  });

  test('ignores entries written with an unsupported value serialization format', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const entry = cacheEntry({ key: 'unsupported-key' });
    entry.recording.returnValue = {
      __aecs: 'unsupported:Value',
      value: { ok: true },
    };

    await store.write(entry);

    await expect(
      store.lookup(defaultNamespace, 'unsupported-key'),
    ).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });

  test('raw-key debug write failures leave the usable cache entry intact', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(
      cacheEntry({ key: 'hashed-key', storedAt: '2026-04-29T00:00:00.000Z' }),
      {
        rawKey: { prompt: 'serializable' },
        operationType: 'span',
        operationName: 'expensive-op',
      },
    );
    await store.write(
      cacheEntry({ key: 'hashed-key', storedAt: '2026-04-29T00:00:01.000Z' }),
      {
        rawKey: { unsupported: 1n },
        operationType: 'span',
        operationName: 'expensive-op',
      },
    );

    await expect(
      store.lookup(defaultNamespace, 'hashed-key'),
    ).resolves.toMatchObject({ storedAt: '2026-04-29T00:00:01.000Z' });
    await expect(
      store.lookupWithDebug(defaultNamespace, 'hashed-key'),
    ).resolves.not.toHaveProperty('debugKey');
  });

  test('clear removes matching normal and raw-key debug entries', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(
      cacheEntry({ key: 'first', storedAt: '2026-04-29T00:00:00.000Z' }),
      {
        rawKey: { prompt: 'first' },
        operationType: 'span',
        operationName: 'expensive-op',
      },
    );
    await store.write(
      cacheEntry({ key: 'second', storedAt: '2026-04-29T00:00:01.000Z' }),
      {
        rawKey: { prompt: 'second' },
        operationType: 'span',
        operationName: 'expensive-op',
      },
    );

    await store.clear({ namespace: defaultNamespace, key: 'first' });

    expect(await readCacheKeys(workspacePath)).toEqual(['second']);
    expect(await readDebugKeys(workspacePath)).toEqual(['second']);

    await store.clear({ namespace: defaultNamespace });

    expect(
      existsSync(
        resolve(
          workspacePath,
          '.agent-evals/cache',
          sanitizeSegment(defaultNamespace),
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(
          workspacePath,
          '.agent-evals/cache-debug',
          sanitizeSegment(defaultNamespace),
        ),
      ),
    ).toBe(false);
  });

  test('ignores old aggregate owner cache files', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const oldCacheDir = resolve(workspacePath, '.agent-evals/cache');
    await rm(oldCacheDir, { recursive: true, force: true });
    await mkdir(oldCacheDir, { recursive: true });
    await writeFile(
      resolve(oldCacheDir, 'debug-eval.json'),
      JSON.stringify({
        version: 1,
        owner: 'debug-eval',
        entries: { 'hashed-key': cacheEntry({ key: 'hashed-key' }) },
      }),
    );

    await expect(
      store.lookup(defaultNamespace, 'hashed-key'),
    ).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });

  test('ignores unindexed single-entry cache files until manual repair removes them', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({
      maxEntriesPerNamespace: 1,
      workspaceRoot: workspacePath,
    });
    await mkdir(
      resolve(
        workspacePath,
        '.agent-evals/cache',
        sanitizeSegment(defaultNamespace),
      ),
      { recursive: true },
    );
    await writeFile(
      cacheEntryPath(workspacePath, defaultNamespace, 'legacy-key'),
      brotliCompressSync(
        Buffer.from(JSON.stringify(cacheEntry({ key: 'legacy-key' })), 'utf8'),
      ),
    );

    await expect(
      store.lookup(defaultNamespace, 'legacy-key'),
    ).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);

    await store.write(cacheEntry({ key: 'indexed-key' }));

    expect(await readCacheKeys(workspacePath)).toEqual([
      'indexed-key',
      'legacy-key',
    ]);

    const repairSummary = await store.repair();

    expect(repairSummary.removedCacheFiles).toBe(1);
    expect(await readCacheKeys(workspacePath)).toEqual(['indexed-key']);
  });

  test('manual repair removes stale index rows and unindexed cache artifacts', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    await store.write(cacheEntry({ key: 'indexed-key' }));
    await store.write(cacheEntry({ key: 'stale-key' }), {
      rawKey: { prompt: 'stale' },
      operationType: 'span',
      operationName: 'expensive-op',
    });
    await rm(cacheEntryPath(workspacePath, defaultNamespace, 'stale-key'), {
      force: true,
    });

    await writeFile(
      cacheEntryPath(workspacePath, defaultNamespace, 'legacy-key'),
      brotliCompressSync(
        Buffer.from(JSON.stringify(cacheEntry({ key: 'legacy-key' })), 'utf8'),
      ),
    );
    await mkdir(
      dirname(debugEntryPath(workspacePath, defaultNamespace, 'legacy-key')),
      { recursive: true },
    );
    await writeFile(
      debugEntryPath(workspacePath, defaultNamespace, 'legacy-key'),
      '{}',
    );
    const orphanBlob = await store.externalJsonStore.write(
      JSON.stringify({ orphan: true }),
    );

    const repairSummary = await store.repair();

    expect(repairSummary).toEqual({
      removedCacheFiles: 1,
      removedDebugFiles: 2,
      removedBlobFiles: 1,
      removedIndexRows: 1,
      rewrittenIndexes: 1,
    });
    expect(await readCacheKeys(workspacePath)).toEqual(['indexed-key']);
    expect(await readDebugKeys(workspacePath)).toEqual([]);
    expect(existsSync(resolve(store.blobDir(), orphanBlob.path))).toBe(false);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ key: 'indexed-key' }),
    ]);
  });

  test('sanitized namespace collisions do not leak lookup or clear behavior', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const slashNamespace = 'collision/eval';
    const underscoreNamespace = 'collision_eval';

    await store.write(
      cacheEntry({
        key: 'slash-key',
        namespace: slashNamespace,
        storedAt: '2026-04-29T00:00:00.000Z',
      }),
    );
    await store.write(
      cacheEntry({
        key: 'underscore-key',
        namespace: underscoreNamespace,
        storedAt: '2026-04-29T00:00:01.000Z',
      }),
    );

    await expect(
      store.lookup(slashNamespace, 'underscore-key'),
    ).resolves.toBeNull();
    await expect(
      store.lookup(underscoreNamespace, 'underscore-key'),
    ).resolves.toMatchObject({ namespace: underscoreNamespace });

    await store.clear({ namespace: slashNamespace });

    await expect(store.lookup(slashNamespace, 'slash-key')).resolves.toBeNull();
    await expect(
      store.lookup(underscoreNamespace, 'underscore-key'),
    ).resolves.toMatchObject({ namespace: underscoreNamespace });
  });

  test('buffered cache commits only the selected write and its raw key', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const losing = createBufferedCacheStore(store);
    const winning = createBufferedCacheStore(store);

    await losing.write(cacheEntry({ key: 'losing-key' }), {
      rawKey: { candidate: 'losing' },
      operationType: 'span',
      operationName: 'expensive-op',
    });
    await winning.write(cacheEntry({ key: 'winning-key' }), {
      rawKey: { candidate: 'winning' },
      operationType: 'span',
      operationName: 'expensive-op',
    });

    await winning.commit();

    expect(await readCacheKeys(workspacePath)).toEqual(['winning-key']);

    expect(await readDebugKeys(workspacePath)).toEqual(['winning-key']);
    const debugFile = await readDebugKeyEntry(workspacePath, 'winning-key');
    expect(debugFile.rawKey).toEqual({ candidate: 'winning' });
  });

  test('buffered cache lookup materializes pending external blobs', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const buffered = createBufferedCacheStore(store);
    const rows = Array.from({ length: 160 }, (_, index) => ({
      index,
      message: 'repeatable nested tree payload',
      status: index % 2 === 0 ? 'pass' : 'fail',
    }));
    const entry = cacheEntry({ key: 'hashed-key' });
    entry.recording = await serializeCacheRecording(
      { returnValue: { payload: { rows } }, finalAttributes: {}, ops: [] },
      { externalJsonStore: buffered.externalJsonStore },
    );

    await buffered.write(entry);

    await expect(
      buffered.lookup(defaultNamespace, 'hashed-key'),
    ).resolves.toMatchObject({
      recording: { returnValue: { payload: { rows } } },
    });
  });
});
