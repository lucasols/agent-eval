import {
  evalTracer,
  setEvalOutput,
  type CacheAdapter,
  type EvalCacheConfig,
} from '@agent-evals/sdk';
import { extractCacheEntries, type CacheEntry } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import { runCase } from './runExecution.ts';

type CacheOptionsInput = { cacheKey: string };

function createCountingCacheAdapter() {
  const entries = new Map<string, CacheEntry>();
  let lookupCount = 0;
  let writeCount = 0;

  const adapter: CacheAdapter = {
    lookup(namespace, keyHash) {
      lookupCount += 1;
      return Promise.resolve(entries.get(`${namespace}:${keyHash}`) ?? null);
    },
    write(entry) {
      writeCount += 1;
      entries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  };

  return {
    adapter,
    counts() {
      return { lookupCount, writeCount };
    },
    resetCounts() {
      lookupCount = 0;
      writeCount = 0;
    },
  };
}

async function runCacheOptionsCase(params: {
  adapter: CacheAdapter;
  calls: { span: number; value: number; score: number };
  cache?: EvalCacheConfig;
  cacheMode?: 'use' | 'bypass' | 'refresh';
  input?: CacheOptionsInput;
  startTime?: number;
}) {
  return await runCase<CacheOptionsInput>({
    evalDef: {
      id: 'cache-options-eval',
      ...(params.cache === undefined ? {} : { cache: params.cache }),
      cases: [{ id: 'case-one', input: params.input ?? { cacheKey: 'same' } }],
      execute: async ({ input }) => {
        await evalTracer.span(
          {
            kind: 'tool',
            name: 'cached-span',
            cache: {
              namespace: 'cache-options-eval__cached-span',
              key: { cacheKey: input.cacheKey },
            },
          },
          () => {
            params.calls.span += 1;
            setEvalOutput('spanCalls', params.calls.span);
            return { spanCalls: params.calls.span };
          },
        );

        await evalTracer.cache(
          { name: 'root-value', key: { cacheKey: input.cacheKey } },
          () => {
            params.calls.value += 1;
            setEvalOutput('valueCalls', params.calls.value);
            return { valueCalls: params.calls.value };
          },
        );
      },
      scores: {
        quality: {
          compute: async ({ input }) => {
            const score = await evalTracer.span(
              {
                kind: 'scorer',
                name: 'cached-score',
                cache: {
                  namespace: 'cache-options-eval__cached-score',
                  key: { cacheKey: input.cacheKey },
                },
              },
              () => {
                params.calls.score += 1;
                return 0.75;
              },
            );
            return typeof score === 'number' ? score : 0;
          },
        },
      },
    },
    evalId: 'cache-options-eval',
    evalCase: { id: 'case-one', input: params.input ?? { cacheKey: 'same' } },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: params.startTime ?? Date.now(),
    cacheAdapter: params.adapter,
    cacheMode: params.cacheMode ?? 'use',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/cache-options.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });
}

function getOnlyScoreSpan(
  result: Awaited<ReturnType<typeof runCacheOptionsCase>>,
) {
  const scoreTrace = result.caseDetail.scoringTraces?.quality;
  const span = scoreTrace?.trace[0];
  if (span === undefined) {
    throw new Error('Expected cached scorer span');
  }
  return span;
}

function getSpanStatus(
  result: Awaited<ReturnType<typeof runCacheOptionsCase>>,
): unknown {
  return result.caseDetail.trace.find((span) => span.name === 'cached-span')
    ?.attributes?.['cache.status'];
}

function getScoreStatus(
  result: Awaited<ReturnType<typeof runCacheOptionsCase>>,
): unknown {
  return getOnlyScoreSpan(result).attributes?.['cache.status'];
}

function expectNonNegativeAge(value: unknown): void {
  expect(typeof value).toBe('number');
  if (typeof value === 'number') {
    expect(value).toBeGreaterThanOrEqual(0);
  }
}

function getRootValueRef(
  result: Awaited<ReturnType<typeof runCacheOptionsCase>>,
) {
  const ref = result.caseDetail.cacheRefs[0];
  if (ref === undefined) {
    throw new Error('Expected root value cache ref');
  }
  return ref;
}

test('per-eval cache options default to read/write behavior', async () => {
  const store = createCountingCacheAdapter();
  const calls = { span: 0, value: 0, score: 0 };

  const first = await runCacheOptionsCase({ adapter: store.adapter, calls });
  expect(first.caseDetail.status).toBe('pass');
  expect(store.counts()).toEqual({ lookupCount: 3, writeCount: 3 });
  expect(calls).toEqual({ span: 1, value: 1, score: 1 });
  expect(getSpanStatus(first)).toBe('miss');
  expect(getRootValueRef(first).status).toBe('miss');
  expect(getScoreStatus(first)).toBe('miss');

  store.resetCounts();
  const second = await runCacheOptionsCase({ adapter: store.adapter, calls });
  expect(second.caseDetail.status).toBe('pass');
  expect(store.counts()).toEqual({ lookupCount: 3, writeCount: 0 });
  expect(calls).toEqual({ span: 1, value: 1, score: 1 });
  expect(getSpanStatus(second)).toBe('hit');
  expect(getRootValueRef(second).status).toBe('hit');
  expect(getScoreStatus(second)).toBe('hit');
});

test('cache hit age ignores shifted eval time', async () => {
  const store = createCountingCacheAdapter();
  const calls = { span: 0, value: 0, score: 0 };

  await runCacheOptionsCase({ adapter: store.adapter, calls });

  const hit = await runCacheOptionsCase({
    adapter: store.adapter,
    calls,
    startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
  });

  const cachedSpan = hit.caseDetail.trace.find(
    (span) => span.name === 'cached-span',
  );
  expectNonNegativeAge(cachedSpan?.attributes?.['cache.age']);
  expectNonNegativeAge(getRootValueRef(hit).age);
  expectNonNegativeAge(getOnlyScoreSpan(hit).attributes?.['cache.age']);
});

test('per-eval store=false reads hits and leaves misses unstored', async () => {
  const store = createCountingCacheAdapter();
  const calls = { span: 0, value: 0, score: 0 };

  await runCacheOptionsCase({ adapter: store.adapter, calls });

  store.resetCounts();
  const hit = await runCacheOptionsCase({
    adapter: store.adapter,
    calls,
    cache: { store: false },
  });
  expect(hit.caseDetail.status).toBe('pass');
  expect(store.counts()).toEqual({ lookupCount: 3, writeCount: 0 });
  expect(calls).toEqual({ span: 1, value: 1, score: 1 });
  expect(getSpanStatus(hit)).toBe('hit');
  expect(getRootValueRef(hit).status).toBe('hit');
  expect(getScoreStatus(hit)).toBe('hit');

  store.resetCounts();
  const miss = await runCacheOptionsCase({
    adapter: store.adapter,
    calls,
    cache: { store: false },
    input: { cacheKey: 'miss' },
  });
  expect(miss.caseDetail.status).toBe('pass');
  expect(store.counts()).toEqual({ lookupCount: 3, writeCount: 0 });
  expect(calls).toEqual({ span: 2, value: 2, score: 2 });
  const span = miss.caseDetail.trace.find(
    (item) => item.name === 'cached-span',
  );
  expect(span?.attributes).toMatchObject({
    'cache.status': 'miss',
    'cache.stored': false,
  });
  expect(getRootValueRef(miss)).toMatchObject({
    status: 'miss',
    stored: false,
  });
  expect(getOnlyScoreSpan(miss).attributes).toMatchObject({
    'cache.status': 'miss',
    'cache.stored': false,
  });
  expect(
    extractCacheEntries(miss.caseDetail.trace, miss.caseDetail.cacheRefs),
  ).toEqual([
    expect.objectContaining({ action: 'notStored', stored: false }),
    expect.objectContaining({ action: 'notStored', stored: false }),
  ]);

  store.resetCounts();
  const refresh = await runCacheOptionsCase({
    adapter: store.adapter,
    calls,
    cache: { store: false },
    cacheMode: 'refresh',
  });
  expect(refresh.caseDetail.status).toBe('pass');
  expect(store.counts()).toEqual({ lookupCount: 0, writeCount: 0 });
  expect(getSpanStatus(refresh)).toBe('refresh');
  expect(refresh.caseDetail.trace[0]?.attributes?.['cache.stored']).toBe(false);
  expect(getRootValueRef(refresh)).toMatchObject({
    status: 'refresh',
    stored: false,
  });
  expect(getOnlyScoreSpan(refresh).attributes?.['cache.stored']).toBe(false);
});

test('per-eval read=false skips lookups but still stores when enabled', async () => {
  const store = createCountingCacheAdapter();
  const calls = { span: 0, value: 0, score: 0 };

  await runCacheOptionsCase({ adapter: store.adapter, calls });

  store.resetCounts();
  const result = await runCacheOptionsCase({
    adapter: store.adapter,
    calls,
    cache: { read: false },
  });
  expect(result.caseDetail.status).toBe('pass');
  expect(store.counts()).toEqual({ lookupCount: 0, writeCount: 3 });
  expect(calls).toEqual({ span: 2, value: 2, score: 2 });
  expect(result.caseDetail.trace[0]?.attributes).toMatchObject({
    'cache.status': 'miss',
    'cache.read': false,
  });
  expect(getRootValueRef(result)).toMatchObject({
    status: 'miss',
    read: false,
  });
  expect(getOnlyScoreSpan(result).attributes).toMatchObject({
    'cache.status': 'miss',
    'cache.read': false,
  });
});

test('per-eval read=false and store=false bypasses cache reads and writes', async () => {
  const store = createCountingCacheAdapter();
  const calls = { span: 0, value: 0, score: 0 };

  await runCacheOptionsCase({ adapter: store.adapter, calls });

  store.resetCounts();
  const result = await runCacheOptionsCase({
    adapter: store.adapter,
    calls,
    cache: { read: false, store: false },
  });
  expect(result.caseDetail.status).toBe('pass');
  expect(store.counts()).toEqual({ lookupCount: 0, writeCount: 0 });
  expect(calls).toEqual({ span: 2, value: 2, score: 2 });
  expect(getSpanStatus(result)).toBe('bypass');
  expect(getRootValueRef(result).status).toBe('bypass');
  expect(getScoreStatus(result)).toBe('bypass');
});
