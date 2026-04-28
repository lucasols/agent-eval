import {
  extractCacheHits,
  type EvalTraceSpan,
  type TraceCacheRef,
} from '@agent-evals/shared';
import { expect, test } from 'vitest';

function span(overrides: Partial<EvalTraceSpan>): EvalTraceSpan {
  return {
    id: overrides.id ?? 'span-1',
    parentId: overrides.parentId ?? null,
    caseId: overrides.caseId ?? 'case-1',
    kind: overrides.kind ?? 'custom',
    name: overrides.name ?? 'test-span',
    attributes: overrides.attributes,
    status: overrides.status ?? 'ok',
    startedAt: overrides.startedAt ?? '2026-04-28T00:00:00.000Z',
    endedAt: overrides.endedAt ?? '2026-04-28T00:00:00.100Z',
    error: overrides.error,
    errors: overrides.errors,
    warning: overrides.warning,
    warnings: overrides.warnings,
  };
}

test('collects span-level cache hits', () => {
  const entries = extractCacheHits(
    [
      span({
        id: 'a',
        name: 'fetch-user',
        attributes: {
          'cache.status': 'hit',
          'cache.key': 'k-abc',
          'cache.namespace': 'eval__fetch-user',
          'cache.storedAt': '2026-04-27T00:00:00.000Z',
          'cache.age': 60_000,
        },
      }),
    ],
    [],
  );

  expect(entries).toEqual([
    {
      id: 'a',
      source: 'span',
      origin: 'span',
      name: 'fetch-user',
      namespace: 'eval__fetch-user',
      key: 'k-abc',
      storedAt: '2026-04-27T00:00:00.000Z',
      age: 60_000,
      spanId: 'a',
    },
  ]);
});

test('skips non-hit span-level statuses', () => {
  for (const status of ['miss', 'refresh', 'bypass'] as const) {
    expect(
      extractCacheHits(
        [
          span({
            id: 's',
            attributes: {
              'cache.status': status,
              'cache.key': 'k',
              'cache.namespace': 'n',
            },
          }),
        ],
        [],
      ),
    ).toEqual([]);
  }
});

test('emits one entry per value cache.refs hit and skips other statuses', () => {
  const refs: TraceCacheRef[] = [
    { type: 'value', name: 'lookup', namespace: 'n', key: 'k1', status: 'hit' },
    { type: 'value', name: 'other', namespace: 'n', key: 'k2', status: 'miss' },
    {
      type: 'value',
      name: 'lookup',
      namespace: 'n',
      key: 'k3',
      status: 'hit',
      storedAt: '2026-04-27T00:00:00.000Z',
      age: 1000,
    },
  ];

  const entries = extractCacheHits(
    [
      span({
        id: 'parent',
        name: 'workflow',
        attributes: { 'cache.refs': refs },
      }),
    ],
    [],
  );

  expect(entries).toEqual([
    {
      id: 'parent:value:0',
      source: 'value',
      origin: 'span',
      name: 'lookup',
      namespace: 'n',
      key: 'k1',
      storedAt: undefined,
      age: undefined,
      spanId: 'parent',
    },
    {
      id: 'parent:value:2',
      source: 'value',
      origin: 'span',
      name: 'lookup',
      namespace: 'n',
      key: 'k3',
      storedAt: '2026-04-27T00:00:00.000Z',
      age: 1000,
      spanId: 'parent',
    },
  ]);
});

test('emits spanless caseCacheRefs hits with origin=caseRoot', () => {
  const entries = extractCacheHits(
    [],
    [
      {
        type: 'value',
        name: 'top-level',
        namespace: 'eval__top',
        key: 'k-top',
        status: 'hit',
        storedAt: '2026-04-27T00:00:00.000Z',
        age: 5_000,
      },
      {
        type: 'value',
        name: 'top-level-miss',
        namespace: 'eval__top',
        key: 'k-other',
        status: 'miss',
      },
    ],
  );

  expect(entries).toEqual([
    {
      id: 'case:value:0',
      source: 'value',
      origin: 'caseRoot',
      name: 'top-level',
      namespace: 'eval__top',
      key: 'k-top',
      storedAt: '2026-04-27T00:00:00.000Z',
      age: 5_000,
      spanId: undefined,
    },
  ]);
});

test('ignores malformed cache.refs and missing span attributes', () => {
  const entries = extractCacheHits(
    [
      span({ id: 'a' }),
      span({ id: 'b', attributes: { 'cache.status': 'hit' } }),
      span({
        id: 'c',
        attributes: {
          'cache.refs': [
            { not: 'a-ref' },
            { type: 'value', status: 'hit' },
            null,
          ],
        },
      }),
    ],
    [],
  );

  expect(entries).toEqual([]);
});
