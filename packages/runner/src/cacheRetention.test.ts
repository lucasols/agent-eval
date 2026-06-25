import { expect, test } from 'vitest';
import {
  pruneCacheEntriesByMaxBytes,
  type CacheRetentionIndex,
  type CacheRetentionRunReference,
} from './cacheRetention.ts';

const namespace = 'eval.expensive-op';

async function pruneTestCache(params: {
  index: CacheRetentionIndex;
  maxBytes: number;
  cacheBytesByKey: ReadonlyMap<string, number>;
  runReferences?: readonly CacheRetentionRunReference[];
  oldRunMaxAgeMs?: number;
  nowMs?: number;
}) {
  const removedKeyBatches: Array<{ namespace: string; keys: string[] }> = [];
  const removedEntries = await pruneCacheEntriesByMaxBytes({
    indexes: [params.index],
    runReferences: params.runReferences,
    oldRunMaxAgeMs: params.oldRunMaxAgeMs,
    nowMs: params.nowMs,
    maxBytesForNamespace: () => params.maxBytes,
    cacheEntryBytes: (_namespace, key) =>
      Promise.resolve(params.cacheBytesByKey.get(key) ?? 0),
    debugEntryBytes: () => Promise.resolve(0),
    externalJsonBlobBytes: () => Promise.resolve(0),
    removeEntries: (removedNamespace, keys) => {
      removedKeyBatches.push({
        namespace: removedNamespace,
        keys: [...keys].toSorted(),
      });
      return Promise.resolve();
    },
  });

  return { removedEntries, removedKeyBatches };
}

function cacheIndex(keys: readonly string[]): CacheRetentionIndex {
  return {
    namespace,
    entries: Object.fromEntries(
      keys.map((key, index) => [
        key,
        {
          storedAt: `2026-04-29T00:00:0${String(index)}.000Z`,
          lastAccessedAt: null,
          blobRefs: [],
        },
      ]),
    ),
  };
}

test('prunes entries only referenced by deleted evals even when under budget', async () => {
  const result = await pruneTestCache({
    index: cacheIndex(['deleted-eval-cache', 'latest-eval-cache']),
    maxBytes: 100,
    cacheBytesByKey: new Map([
      ['deleted-eval-cache', 10],
      ['latest-eval-cache', 10],
    ]),
    runReferences: [
      {
        namespace,
        key: 'deleted-eval-cache',
        evalExists: false,
        latestRunForEval: false,
        runStartedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        namespace,
        key: 'latest-eval-cache',
        evalExists: true,
        latestRunForEval: true,
        runStartedAt: '2026-04-29T00:00:00.000Z',
      },
    ],
  });

  expect(result.removedEntries).toMatchObject([
    { key: 'deleted-eval-cache', reason: 'nonExistingEval' },
  ]);
  expect(result.removedKeyBatches).toEqual([
    { namespace, keys: ['deleted-eval-cache'] },
  ]);
});

test('prunes old run cache references before unreferenced cache entries', async () => {
  const result = await pruneTestCache({
    index: {
      namespace,
      entries: {
        'unreferenced-cache': {
          storedAt: '2026-04-01T00:00:00.000Z',
          lastAccessedAt: null,
          blobRefs: [],
        },
        'old-run-cache': {
          storedAt: '2026-04-29T00:00:00.000Z',
          lastAccessedAt: '2026-04-29T00:00:00.000Z',
          blobRefs: [],
        },
        'latest-run-cache': {
          storedAt: '2026-04-29T00:00:01.000Z',
          lastAccessedAt: null,
          blobRefs: [],
        },
      },
    },
    maxBytes: 20,
    oldRunMaxAgeMs: 365 * 24 * 60 * 60 * 1000,
    nowMs: Date.parse('2026-04-30T00:00:00.000Z'),
    cacheBytesByKey: new Map([
      ['unreferenced-cache', 10],
      ['old-run-cache', 10],
      ['latest-run-cache', 10],
    ]),
    runReferences: [
      {
        namespace,
        key: 'old-run-cache',
        evalExists: true,
        latestRunForEval: false,
        runStartedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        namespace,
        key: 'latest-run-cache',
        evalExists: true,
        latestRunForEval: true,
        runStartedAt: '2026-04-29T00:00:00.000Z',
      },
    ],
  });

  expect(result.removedEntries).toMatchObject([
    { key: 'old-run-cache', reason: 'retentionLimit' },
  ]);
});

test('prunes old non-latest run cache entries even when under budget', async () => {
  const result = await pruneTestCache({
    index: cacheIndex(['old-run-cache', 'recent-run-cache']),
    maxBytes: 100,
    cacheBytesByKey: new Map([
      ['old-run-cache', 10],
      ['recent-run-cache', 10],
    ]),
    oldRunMaxAgeMs: 15 * 24 * 60 * 60 * 1000,
    nowMs: Date.parse('2026-04-30T00:00:00.000Z'),
    runReferences: [
      {
        namespace,
        key: 'old-run-cache',
        evalExists: true,
        latestRunForEval: false,
        runStartedAt: '2026-04-14T23:59:59.999Z',
      },
      {
        namespace,
        key: 'recent-run-cache',
        evalExists: true,
        latestRunForEval: false,
        runStartedAt: '2026-04-15T00:00:00.001Z',
      },
    ],
  });

  expect(result.removedEntries).toMatchObject([
    { key: 'old-run-cache', reason: 'oldRun' },
  ]);
});

test('keeps cache entries referenced by any recent non-latest run', async () => {
  const result = await pruneTestCache({
    index: cacheIndex(['shared-cache']),
    maxBytes: 100,
    cacheBytesByKey: new Map([['shared-cache', 10]]),
    oldRunMaxAgeMs: 15 * 24 * 60 * 60 * 1000,
    nowMs: Date.parse('2026-04-30T00:00:00.000Z'),
    runReferences: [
      {
        namespace,
        key: 'shared-cache',
        evalExists: true,
        latestRunForEval: false,
        runStartedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        namespace,
        key: 'shared-cache',
        evalExists: true,
        latestRunForEval: false,
        runStartedAt: '2026-04-29T00:00:00.000Z',
      },
    ],
  });

  expect(result.removedEntries).toEqual([]);
});

test('keeps latest-run cache entries even when the namespace remains over budget', async () => {
  const result = await pruneTestCache({
    index: cacheIndex(['old-run-cache', 'latest-run-cache']),
    maxBytes: 5,
    oldRunMaxAgeMs: 15 * 24 * 60 * 60 * 1000,
    nowMs: Date.parse('2026-04-30T00:00:00.000Z'),
    cacheBytesByKey: new Map([
      ['old-run-cache', 10],
      ['latest-run-cache', 10],
    ]),
    runReferences: [
      {
        namespace,
        key: 'old-run-cache',
        evalExists: true,
        latestRunForEval: false,
        runStartedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        namespace,
        key: 'latest-run-cache',
        evalExists: true,
        latestRunForEval: true,
        runStartedAt: '2026-04-29T00:00:00.000Z',
      },
    ],
  });

  expect(result.removedEntries).toMatchObject([
    { key: 'old-run-cache', reason: 'oldRun' },
  ]);
});
