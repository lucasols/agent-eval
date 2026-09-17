import {
  evalTracer,
  runInEvalScope,
  setEvalOutput,
  type CacheAdapter,
  type TraceSpanInfo,
} from '@agent-evals/sdk';
import type { CacheEntry, CacheMode } from '@agent-evals/shared';
import { expect, expectTypeOf, test, vi } from 'vitest';
import { z } from 'zod';

function createCache() {
  const entries: CacheEntry[] = [];
  const adapter: CacheAdapter = {
    lookup: () => Promise.resolve(entries.at(-1) ?? null),
    write: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
  return { entries, adapter };
}

test('cached and uncached spans preserve callback types outside eval runs', async () => {
  const value = { createdAt: new Date(), label: 'refund' };
  const parse = vi.fn(() => false);
  const responseSchema = z
    .object({ createdAt: z.date(), label: z.string() })
    .refine(parse);
  const info = {
    kind: 'tool',
    name: 'refund',
    cache: { namespace: 'refund', key: 'order', responseSchema },
  } satisfies TraceSpanInfo;
  const result = evalTracer.span(info, () => value);
  expectTypeOf(result).toEqualTypeOf<Promise<typeof value>>();
  expect(await result).toBe(value);
  const withHandle = evalTracer.span(info, (span) => {
    span.setAttribute('label', value.label);
    return Promise.resolve(value);
  });
  expectTypeOf(withHandle).toEqualTypeOf<Promise<typeof value>>();
  expect(await withHandle).toBe(value);
  const withoutSchema = evalTracer.span(
    {
      kind: 'tool',
      name: 'refund',
      cache: { namespace: 'refund', key: 'order' },
    },
    () => value,
  );
  expectTypeOf(withoutSchema).toEqualTypeOf<Promise<typeof value>>();
  expect(await withoutSchema).toBe(value);
  const uncached = evalTracer.span(
    { kind: 'tool', name: 'refund' },
    () => value,
  );
  expectTypeOf(uncached).toEqualTypeOf<Promise<typeof value>>();
  expect(await uncached).toBe(value);
  const evalWithoutCache = await runInEvalScope('case', () =>
    evalTracer.span(info, () => value),
  );
  expect(evalWithoutCache.error).toBeUndefined();
  expect(evalWithoutCache.result).toBe(value);
  expect(parse).not.toHaveBeenCalled();
});

test('parses revived responses with async transforms only on eval cache hits', async () => {
  const cache = createCache();
  const transform = vi.fn(async (value: { createdAt: Date; label: string }) => {
    await Promise.resolve();
    return { ...value, label: value.label.toUpperCase() };
  });
  const callback = vi.fn(() => {
    setEvalOutput('executed', true);
    return { createdAt: new Date('2026-09-16T00:00:00Z'), label: 'refund' };
  });
  const responseSchema = z
    .object({ createdAt: z.date(), label: z.string() })
    .transform(transform);
  const run = (mode: CacheMode) =>
    runInEvalScope(
      'case',
      () =>
        evalTracer.span(
          {
            kind: 'tool',
            name: 'refund',
            cache: { namespace: 'refund', key: 'order', responseSchema },
          },
          callback,
        ),
      { cacheContext: { adapter: cache.adapter, mode, evalId: 'refund' } },
    );

  const first = await run('use');
  expect(first.error).toBeUndefined();
  expect(first.result?.label).toBe('refund');
  expect(transform).not.toHaveBeenCalled();
  const hit = await run('use');
  expect(hit.error).toBeUndefined();
  expect(hit.result).toEqual({
    createdAt: new Date('2026-09-16T00:00:00Z'),
    label: 'REFUND',
  });
  expect(hit.scope.outputs).toEqual({ executed: true });
  expect(transform).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledTimes(1);
  await run('refresh');
  await run('bypass');
  expect(transform).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledTimes(3);
});

test('invalid cached responses fail before effects replay and can be refreshed', async () => {
  const cache = createCache();
  const callback = vi.fn(() => {
    setEvalOutput('executed', true);
    return { label: 'refund' };
  });
  const run = (mode: CacheMode) =>
    runInEvalScope(
      'case',
      () =>
        evalTracer.span(
          {
            kind: 'tool',
            name: 'refund',
            cache: {
              namespace: 'refund',
              key: 'order',
              responseSchema: z.object({ label: z.string() }),
            },
          },
          callback,
        ),
      { cacheContext: { adapter: cache.adapter, mode, evalId: 'refund' } },
    );
  await run('use');
  const entry = cache.entries[0];
  if (entry === undefined) throw new Error('Missing cache entry');
  entry.recording.returnValue = { label: 123 };

  const invalid = await run('use');
  expect(invalid.error?.message).toContain(
    'failed cache.responseSchema validation',
  );
  expect(invalid.scope.spans[0]?.status).toBe('error');
  expect(invalid.scope.outputs).toEqual({});
  expect(callback).toHaveBeenCalledTimes(1);
  expect(cache.entries).toHaveLength(1);

  const refreshed = await run('refresh');
  expect(refreshed.error).toBeUndefined();
  const hit = await run('use');
  expect(hit.error).toBeUndefined();
  expect(hit.result).toEqual({ label: 'refund' });
  expect(callback).toHaveBeenCalledTimes(2);
});
