import {
  extractCacheEntries,
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
      action: 'hit',
      status: 'hit',
      stored: true,
      name: 'fetch-user',
      namespace: 'eval__fetch-user',
      key: 'k-abc',
      storedAt: '2026-04-27T00:00:00.000Z',
      age: 60_000,
      spanId: 'a',
    },
  ]);
});

test('collects span-level cache entries added by misses and refreshes', () => {
  const entries = extractCacheEntries(
    [
      span({
        id: 'missed',
        name: 'fetch-user',
        attributes: {
          'cache.status': 'miss',
          'cache.key': 'k-miss',
          'cache.namespace': 'eval__fetch-user',
        },
      }),
      span({
        id: 'refreshed',
        name: 'fetch-plan',
        attributes: {
          'cache.status': 'refresh',
          'cache.key': 'k-refresh',
          'cache.namespace': 'eval__fetch-plan',
        },
      }),
      span({
        id: 'bypassed',
        name: 'fetch-bypass',
        attributes: {
          'cache.status': 'bypass',
          'cache.key': 'k-bypass',
          'cache.namespace': 'eval__fetch-bypass',
        },
      }),
    ],
    [],
  );

  expect(entries).toEqual([
    {
      id: 'missed',
      source: 'span',
      origin: 'span',
      action: 'added',
      status: 'miss',
      stored: true,
      name: 'fetch-user',
      namespace: 'eval__fetch-user',
      key: 'k-miss',
      storedAt: undefined,
      age: undefined,
      spanId: 'missed',
    },
    {
      id: 'refreshed',
      source: 'span',
      origin: 'span',
      action: 'added',
      status: 'refresh',
      stored: true,
      name: 'fetch-plan',
      namespace: 'eval__fetch-plan',
      key: 'k-refresh',
      storedAt: undefined,
      age: undefined,
      spanId: 'refreshed',
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
      action: 'hit',
      status: 'hit',
      stored: true,
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
      action: 'hit',
      status: 'hit',
      stored: true,
      name: 'lookup',
      namespace: 'n',
      key: 'k3',
      storedAt: '2026-04-27T00:00:00.000Z',
      age: 1000,
      spanId: 'parent',
    },
  ]);
});

test('collects value cache entries added by misses and refreshes', () => {
  const refs: TraceCacheRef[] = [
    {
      type: 'value',
      name: 'lookup',
      namespace: 'n',
      key: 'k1',
      status: 'miss',
    },
    {
      type: 'value',
      name: 'lookup',
      namespace: 'n',
      key: 'k2',
      status: 'refresh',
    },
    {
      type: 'value',
      name: 'lookup',
      namespace: 'n',
      key: 'k3',
      status: 'bypass',
    },
  ];

  const entries = extractCacheEntries(
    [
      span({
        id: 'parent',
        name: 'workflow',
        attributes: { 'cache.refs': refs },
      }),
    ],
    [
      {
        type: 'value',
        name: 'top-level',
        namespace: 'eval__top',
        key: 'k-top',
        status: 'miss',
      },
    ],
  );

  expect(entries).toEqual([
    {
      id: 'parent:value:0',
      source: 'value',
      origin: 'span',
      action: 'added',
      status: 'miss',
      stored: true,
      name: 'lookup',
      namespace: 'n',
      key: 'k1',
      storedAt: undefined,
      age: undefined,
      spanId: 'parent',
    },
    {
      id: 'parent:value:1',
      source: 'value',
      origin: 'span',
      action: 'added',
      status: 'refresh',
      stored: true,
      name: 'lookup',
      namespace: 'n',
      key: 'k2',
      storedAt: undefined,
      age: undefined,
      spanId: 'parent',
    },
    {
      id: 'case:value:0',
      source: 'value',
      origin: 'caseRoot',
      action: 'added',
      status: 'miss',
      stored: true,
      name: 'top-level',
      namespace: 'eval__top',
      key: 'k-top',
      storedAt: undefined,
      age: undefined,
      spanId: undefined,
    },
  ]);
});

test('collects non-stored cache activity separately from persisted entries', () => {
  const entries = extractCacheEntries(
    [
      span({
        id: 'span-miss',
        name: 'read-only-span',
        attributes: {
          'cache.status': 'miss',
          'cache.key': 'k-span',
          'cache.namespace': 'eval__span',
          'cache.stored': false,
        },
      }),
      span({
        id: 'parent',
        name: 'workflow',
        attributes: {
          'cache.refs': [
            {
              type: 'value',
              name: 'read-only-value',
              namespace: 'eval__value',
              key: 'k-value',
              status: 'refresh',
              stored: false,
            },
          ],
        },
      }),
    ],
    [
      {
        type: 'value',
        name: 'top-level',
        namespace: 'eval__top',
        key: 'k-top',
        status: 'miss',
        stored: false,
      },
    ],
  );

  expect(entries).toEqual([
    {
      id: 'span-miss',
      source: 'span',
      origin: 'span',
      action: 'notStored',
      status: 'miss',
      stored: false,
      name: 'read-only-span',
      namespace: 'eval__span',
      key: 'k-span',
      storedAt: undefined,
      age: undefined,
      spanId: 'span-miss',
    },
    {
      id: 'parent:value:0',
      source: 'value',
      origin: 'span',
      action: 'notStored',
      status: 'refresh',
      stored: false,
      name: 'read-only-value',
      namespace: 'eval__value',
      key: 'k-value',
      storedAt: undefined,
      age: undefined,
      spanId: 'parent',
    },
    {
      id: 'case:value:0',
      source: 'value',
      origin: 'caseRoot',
      action: 'notStored',
      status: 'miss',
      stored: false,
      name: 'top-level',
      namespace: 'eval__top',
      key: 'k-top',
      storedAt: undefined,
      age: undefined,
      spanId: undefined,
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
      action: 'hit',
      status: 'hit',
      stored: true,
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
