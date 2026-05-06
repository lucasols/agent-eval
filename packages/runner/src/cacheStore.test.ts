import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { serializeCacheRecording } from '@agent-evals/sdk';
import {
  cacheDebugKeyFileSchema,
  cacheFileSchema,
  type CacheDebugKeyFile,
  type CacheEntry,
  type CacheFile,
} from '@agent-evals/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { createBufferedCacheStore, createFsCacheStore } from './cacheStore.ts';

const workspaces: string[] = [];
const externalJsonBlobPathRegex = /^sha256\/[a-f0-9]{2}\/[a-f0-9]+\.json\.br$/;

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
    namespace: params.namespace ?? 'debug-eval__expensive-op',
    operationType: 'span',
    operationName: 'expensive-op',
    spanName: 'expensive-op',
    spanKind: 'llm',
    storedAt: params.storedAt ?? '2026-04-29T00:00:00.000Z',
    recording: { returnValue: { ok: true }, finalAttributes: {}, ops: [] },
  };
}

async function readCacheFile(
  workspacePath: string,
  owner = 'debug-eval',
): Promise<CacheFile> {
  return cacheFileSchema.parse(
    JSON.parse(
      await readFile(
        resolve(workspacePath, '.agent-evals/cache', `${owner}.json`),
        'utf8',
      ),
    ),
  );
}

async function readDebugKeyFile(
  workspacePath: string,
  owner = 'debug-eval',
): Promise<CacheDebugKeyFile> {
  return cacheDebugKeyFileSchema.parse(
    JSON.parse(
      await readFile(
        resolve(workspacePath, '.agent-evals/cache-debug', `${owner}.json`),
        'utf8',
      ),
    ),
  );
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

    const cacheFile = await readCacheFile(workspacePath);
    expect(cacheFile.entries['hashed-key']).toMatchObject({
      key: 'hashed-key',
      namespace: 'debug-eval__expensive-op',
    });
    expect(JSON.stringify(cacheFile)).not.toContain('refund please');

    const debugFile = await readDebugKeyFile(workspacePath);
    expect(debugFile.entries['hashed-key']).toMatchObject({
      key: 'hashed-key',
      namespace: 'debug-eval__expensive-op',
      operationType: 'span',
      operationName: 'expensive-op',
      rawKey: { prompt: 'refund please', model: 'gpt-4o-mini' },
    });

    await expect(
      store.lookup('debug-eval__expensive-op', 'hashed-key'),
    ).resolves.toMatchObject({ key: 'hashed-key' });
    await expect(
      store.lookupWithDebug('debug-eval__expensive-op', 'hashed-key'),
    ).resolves.toMatchObject({
      key: 'hashed-key',
      debugKey: { rawKey: { prompt: 'refund please' } },
    });
  });

  test('writes cache files with two-space indentation', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(cacheEntry({ key: 'hashed-key' }));

    const rawCacheFile = await readFile(
      resolve(workspacePath, '.agent-evals/cache/debug-eval.json'),
      'utf8',
    );
    expect(rawCacheFile).toContain('\n  "version": 1,');
    expect(rawCacheFile).toContain('\n    "hashed-key": {');
    expect(rawCacheFile).toContain('\n      "key": "hashed-key"');
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
      resolve(workspacePath, '.agent-evals/cache-debug/debug-eval.json'),
      'utf8',
    );
    expect(rawDebugFile).toContain('\n  "version": 1,');
    expect(rawDebugFile).toContain('\n    "hashed-key": {');
    expect(rawDebugFile).toContain('\n      "key": "hashed-key"');
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

    const cacheFile = await readCacheFile(workspacePath);
    const blobRef = getNestedExternalJsonRef(
      cacheFile.entries['hashed-key']?.recording.returnValue,
    );
    expect(blobRef).toMatchObject({ __aecs: 'v1:ExternalJson' });

    const blobPath = getStringProperty(blobRef, 'path');
    expect(blobPath).toMatch(externalJsonBlobPathRegex);
    const compressed = await readFile(resolve(store.blobDir(), blobPath));
    expect(
      JSON.parse(brotliDecompressSync(compressed).toString('utf8')),
    ).toEqual(rows);

    await expect(
      store.lookup('debug-eval__expensive-op', 'hashed-key'),
    ).resolves.toMatchObject({
      recording: { returnValue: { payload: { rows } } },
    });

    await store.clear({
      key: 'hashed-key',
      namespace: 'debug-eval__expensive-op',
    });

    expect(existsSync(resolve(store.blobDir(), blobPath))).toBe(false);
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

    const cacheFile = await readCacheFile(workspacePath);
    const firstRef = getNestedExternalJsonRef(
      cacheFile.entries.first?.recording.returnValue,
    );
    const secondRef = getNestedExternalJsonRef(
      cacheFile.entries.second?.recording.returnValue,
    );

    expect(getStringProperty(firstRef, 'hash')).toBe(
      getStringProperty(secondRef, 'hash'),
    );
    expect(getStringProperty(firstRef, 'path')).toBe(
      getStringProperty(secondRef, 'path'),
    );
  });

  test('lookup succeeds when raw-key debug data is unavailable', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(cacheEntry({ key: 'hashed-key' }));

    await expect(
      store.lookupWithDebug('debug-eval__expensive-op', 'hashed-key'),
    ).resolves.toMatchObject({ key: 'hashed-key' });
    await expect(
      store.lookupWithDebug('debug-eval__expensive-op', 'hashed-key'),
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
      store.lookup('debug-eval__expensive-op', 'unsupported-key'),
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
      store.lookup('debug-eval__expensive-op', 'hashed-key'),
    ).resolves.toMatchObject({ storedAt: '2026-04-29T00:00:01.000Z' });
    await expect(
      store.lookupWithDebug('debug-eval__expensive-op', 'hashed-key'),
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

    await store.clear({ namespace: 'debug-eval__expensive-op', key: 'first' });

    expect(Object.keys((await readCacheFile(workspacePath)).entries)).toEqual([
      'second',
    ]);
    expect(
      Object.keys((await readDebugKeyFile(workspacePath)).entries),
    ).toEqual(['second']);

    await store.clear({ namespace: 'debug-eval__expensive-op' });

    expect(
      existsSync(resolve(workspacePath, '.agent-evals/cache/debug-eval.json')),
    ).toBe(false);
    expect(
      existsSync(
        resolve(workspacePath, '.agent-evals/cache-debug/debug-eval.json'),
      ),
    ).toBe(false);
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

    const cacheFile = await readCacheFile(workspacePath);
    expect(Object.keys(cacheFile.entries)).toEqual(['winning-key']);

    const debugFile = await readDebugKeyFile(workspacePath);
    expect(Object.keys(debugFile.entries)).toEqual(['winning-key']);
    expect(debugFile.entries['winning-key']?.rawKey).toEqual({
      candidate: 'winning',
    });
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
      buffered.lookup('debug-eval__expensive-op', 'hashed-key'),
    ).resolves.toMatchObject({
      recording: { returnValue: { payload: { rows } } },
    });
  });
});
