import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
    codeFingerprint: 'source-fingerprint',
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

describe('filesystem cache store raw-key debug storage', () => {
  test('stores normal entries hash-only and raw keys in the debug folder', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });
    const entry = cacheEntry({ key: 'hashed-key' });

    await store.write(entry, {
      rawKey: { prompt: 'refund please', model: 'gpt-4o-mini' },
      operationType: 'span',
      operationName: 'expensive-op',
      codeFingerprint: 'source-fingerprint',
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

  test('raw-key debug write failures leave the usable cache entry intact', async () => {
    const workspacePath = await createWorkspace();
    const store = createFsCacheStore({ workspaceRoot: workspacePath });

    await store.write(
      cacheEntry({ key: 'hashed-key', storedAt: '2026-04-29T00:00:00.000Z' }),
      {
        rawKey: { prompt: 'serializable' },
        operationType: 'span',
        operationName: 'expensive-op',
        codeFingerprint: 'source-fingerprint',
      },
    );
    await store.write(
      cacheEntry({ key: 'hashed-key', storedAt: '2026-04-29T00:00:01.000Z' }),
      {
        rawKey: { unsupported: 1n },
        operationType: 'span',
        operationName: 'expensive-op',
        codeFingerprint: 'source-fingerprint',
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
        codeFingerprint: 'source-fingerprint',
      },
    );
    await store.write(
      cacheEntry({ key: 'second', storedAt: '2026-04-29T00:00:01.000Z' }),
      {
        rawKey: { prompt: 'second' },
        operationType: 'span',
        operationName: 'expensive-op',
        codeFingerprint: 'source-fingerprint',
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
      codeFingerprint: 'source-fingerprint',
    });
    await winning.write(cacheEntry({ key: 'winning-key' }), {
      rawKey: { candidate: 'winning' },
      operationType: 'span',
      operationName: 'expensive-op',
      codeFingerprint: 'source-fingerprint',
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
});
