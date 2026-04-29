import { deserializeCacheValue, serializeCacheValue } from '@agent-evals/sdk';
import { expect, test } from 'vitest';

const serializationMarker = '__agentEvalsCacheSerialization';

test('keeps root arrays plain while packing nested number arrays', async () => {
  const embedding = Array.from(
    { length: 1536 },
    (_, index) => Math.sin(index) * 0.123456789,
  );
  const value = {
    embeddings: [embedding],
    response: { model: 'text-embedding-3-small' },
    usage: { tokens: 42 },
    warnings: [],
  };

  const serialized = await serializeCacheValue(value);

  expect(await serializeCacheValue(embedding)).toEqual(embedding);
  expect(deserializeCacheValue(serialized)).toEqual(value);
  expect(JSON.stringify(serialized).length).toBeLessThan(
    JSON.stringify(value).length * 0.8,
  );

  const nestedVector = getNestedVector(serialized);
  expect(nestedVector?.type).toBe('Float64Array');
  expect(nestedVector?.length).toBe(1536);
});

test('compresses large nested strings without compressing root strings', async () => {
  const text = 'nested prompt context '.repeat(2000);
  const serialized = await serializeCacheValue({ text });

  expect(await serializeCacheValue(text)).toBe(text);
  expect(deserializeCacheValue(serialized)).toEqual({ text });
  expect(getRecordProperty(serialized, 'text')).toMatchObject({
    [serializationMarker]: 'json-safe-v1',
    type: 'CompressedString',
  });
});

test('compresses large nested JSON subtrees', async () => {
  const rows = Array.from({ length: 2000 }, (_, index) => ({
    index,
    message: 'repeatable nested tree payload',
    status: index % 2 === 0 ? 'pass' : 'fail',
  }));
  const value = { payload: { rows } };

  const serialized = await serializeCacheValue(value);

  expect(deserializeCacheValue(serialized)).toEqual(value);
  expect(JSON.stringify(serialized).length).toBeLessThan(
    JSON.stringify(value).length * 0.8,
  );

  const rowsValue = getRecordProperty(
    getRecordProperty(serialized, 'payload'),
    'rows',
  );
  expect(rowsValue).toMatchObject({
    [serializationMarker]: 'json-safe-v1',
    type: 'CompressedJson',
  });
});

test('round trips rich cache values with small JSON-safe tags', async () => {
  const value = {
    bigint: 123n,
    date: new Date('2024-01-02T03:04:05.000Z'),
    map: new Map<unknown, unknown>([
      ['tier', 'gold'],
      [{ nested: true }, new Set(['a', 'b'])],
    ]),
    negativeZero: -0,
    notANumber: NaN,
    pattern: /refund/giu,
    set: new Set([1, 2, 3]),
    url: new URL('https://example.com/path?q=1'),
    value: undefined,
  };

  const deserialized = deserializeCacheValue(await serializeCacheValue(value));

  expect(deserialized).toMatchObject({
    bigint: 123n,
    date: new Date('2024-01-02T03:04:05.000Z'),
    negativeZero: -0,
    notANumber: NaN,
    pattern: /refund/giu,
    url: new URL('https://example.com/path?q=1'),
    value: undefined,
  });
  if (isRichRoundTripValue(deserialized)) {
    expect(deserialized.map.get('tier')).toBe('gold');
    expect([...deserialized.set]).toEqual([1, 2, 3]);
  } else {
    throw new Error('Expected rich cache value to round trip');
  }
});

test('escapes user objects that contain the cache serialization marker', async () => {
  const value = {
    [serializationMarker]: 'user-authored-value',
    nested: { ok: true },
  };

  const serialized = await serializeCacheValue(value);
  const deserialized = deserializeCacheValue(serialized);

  expect(serialized).not.toEqual(value);
  expect(deserialized).toEqual(value);
});

function isRichRoundTripValue(
  value: unknown,
): value is { map: Map<unknown, unknown>; set: Set<unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'map' in value &&
    value.map instanceof Map &&
    'set' in value &&
    value.set instanceof Set
  );
}

function getNestedVector(value: unknown): Record<string, unknown> | undefined {
  const embeddings = getRecordProperty(value, 'embeddings');
  if (!Array.isArray(embeddings)) return undefined;
  const first: unknown = embeddings.at(0);
  return isRecordLike(first) ? first : undefined;
}

function getRecordProperty(value: unknown, key: string): unknown {
  if (!isRecordLike(value)) return undefined;
  return value[key];
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
