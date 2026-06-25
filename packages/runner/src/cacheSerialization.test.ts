import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  deserializeCacheValue,
  materializeExternalJsonValues,
  serializeCacheValue,
  type CacheSerializationExternalJsonStore,
  type ExternalJsonBlobRef,
} from '@agent-evals/sdk';
import { expect, test } from 'vitest';

const serializationMarker = '__aecs';

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
  expect(nestedVector?.[serializationMarker]).toBe('v1:Float64Array');
  expect(nestedVector?.length).toBe(1536);
});

test('serializes typed array values without expanding numeric properties', async () => {
  const bytes = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
  const value = { imageBytes: bytes };

  const serialized = await serializeCacheValue(value);
  const rawJson = JSON.stringify(serialized);

  expect(deserializeCacheValue(serialized)).toEqual(value);
  expect(rawJson).toContain('"v1:ArrayBufferView"');
  expect(rawJson).toContain('"type":"Uint8Array"');
  expect(rawJson.length).toBeLessThan(JSON.stringify(value).length * 0.5);
  expect(rawJson).not.toContain('"0":0');
});

test('externalizes large nested strings without externalizing root strings', async () => {
  const store = createMemoryExternalJsonStore();
  const text = 'nested prompt context '.repeat(2000);
  const serialized = await serializeCacheValue(
    { text },
    { externalJsonStore: store },
  );

  expect(await serializeCacheValue(text)).toBe(text);
  expect(await deserializeWithExternalJsonStore(serialized, store)).toEqual({
    text,
  });
  expect(getRecordProperty(serialized, 'text')).toMatchObject({
    [serializationMarker]: 'v1:ExternalJson',
  });
});

test('externalizes large nested JSON subtrees', async () => {
  const store = createMemoryExternalJsonStore();
  const rows = Array.from({ length: 2000 }, (_, index) => ({
    index,
    message: 'repeatable nested tree payload',
    status: index % 2 === 0 ? 'pass' : 'fail',
  }));
  const value = { payload: { rows } };

  const serialized = await serializeCacheValue(value, {
    externalJsonStore: store,
  });

  expect(await deserializeWithExternalJsonStore(serialized, store)).toEqual(
    value,
  );

  const rowsValue = getRecordProperty(
    getRecordProperty(serialized, 'payload'),
    'rows',
  );
  expect(rowsValue).toMatchObject({ [serializationMarker]: 'v1:ExternalJson' });
});

test('externalizes nested JSON subtrees above 10 KiB', async () => {
  const store = createMemoryExternalJsonStore();
  const rows = Array.from({ length: 160 }, (_, index) => ({
    index,
    message: 'repeatable nested tree payload',
    status: index % 2 === 0 ? 'pass' : 'fail',
  }));
  const value = { payload: { rows } };
  const rawLength = JSON.stringify(rows).length;

  expect(rawLength).toBeGreaterThanOrEqual(10 * 1024);
  expect(rawLength).toBeLessThan(15 * 1024);

  const serialized = await serializeCacheValue(value, {
    externalJsonStore: store,
  });
  const rowsValue = getRecordProperty(
    getRecordProperty(serialized, 'payload'),
    'rows',
  );

  expect(await deserializeWithExternalJsonStore(serialized, store)).toEqual(
    value,
  );
  expect(rowsValue).toMatchObject({ [serializationMarker]: 'v1:ExternalJson' });
});

test('can skip compression for browser-displayable serialized values', async () => {
  const value = { nested: { text: 'nested prompt context '.repeat(2000) } };

  const serialized = await serializeCacheValue(value, { compress: false });

  expect(deserializeCacheValue(serialized)).toEqual(value);
  expect(
    getRecordProperty(getRecordProperty(serialized, 'nested'), 'text'),
  ).toBe(value.nested.text);
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
  });
  if (isRichRoundTripValue(deserialized)) {
    expect(deserialized.map.get('tier')).toBe('gold');
    expect([...deserialized.set]).toEqual([1, 2, 3]);
  } else {
    throw new Error('Expected rich cache value to round trip');
  }
});

test('omits undefined values instead of writing undefined tags', async () => {
  const value = {
    items: [undefined, 'kept', { missing: undefined, present: true }],
    map: new Map<unknown, unknown>([
      ['present', 'value'],
      ['missing', undefined],
    ]),
    missing: undefined,
    nested: { missing: undefined, present: 1 },
    set: new Set([undefined, 'present']),
  };

  const serialized = await serializeCacheValue(value);
  const deserialized = deserializeCacheValue(serialized);

  expect(JSON.stringify(serialized)).not.toContain('"Undefined"');
  expect(deserialized).toMatchObject({
    items: ['kept', { present: true }],
    nested: { present: 1 },
  });
  if (isUndefinedOmissionValue(deserialized)) {
    expect(Object.hasOwn(deserialized, 'missing')).toBe(false);
    expect(Object.hasOwn(deserialized.nested, 'missing')).toBe(false);
    expect(deserialized.map.has('missing')).toBe(false);
    expect([...deserialized.set]).toEqual(['present']);
  } else {
    throw new Error('Expected rich cache value to round trip');
  }
});

test('preserves undefined values when explicitly requested', async () => {
  const value = {
    items: [undefined, 'kept'],
    missing: undefined,
    nested: { missing: undefined, present: 1 },
  };

  const serialized = await serializeCacheValue(value, {
    preserveUndefined: true,
  });
  const deserialized = deserializeCacheValue(serialized);

  expect(JSON.stringify(serialized)).toContain('"v1:Undefined"');
  expect(deserialized).toEqual(value);
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

function isUndefinedOmissionValue(
  value: unknown,
): value is Record<string, unknown> & {
  map: Map<unknown, unknown>;
  nested: Record<string, unknown>;
  set: Set<unknown>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'map' in value &&
    value.map instanceof Map &&
    'nested' in value &&
    isRecordLike(value.nested) &&
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

async function deserializeWithExternalJsonStore(
  value: unknown,
  store: CacheSerializationExternalJsonStore,
): Promise<unknown> {
  return deserializeCacheValue(
    await materializeExternalJsonValues(value, store),
  );
}

function createMemoryExternalJsonStore(): CacheSerializationExternalJsonStore & {
  blobs: Map<string, string>;
} {
  const blobs = new Map<string, string>();
  return {
    blobs,
    read(ref) {
      const rawJson = blobs.get(ref.hash);
      if (rawJson === undefined) {
        throw new Error(`Missing test blob: ${ref.hash}`);
      }
      return Promise.resolve(rawJson);
    },
    write(rawJson) {
      const ref = memoryExternalJsonRef(rawJson);
      blobs.set(ref.hash, rawJson);
      return Promise.resolve(ref);
    },
  };
}

function memoryExternalJsonRef(rawJson: string): ExternalJsonBlobRef {
  const hash = hashRawJson(rawJson);
  return {
    compressedLength: Buffer.byteLength(rawJson, 'utf8'),
    hash,
    length: Buffer.byteLength(rawJson, 'utf8'),
    path: `memory/${hash.slice('sha256:'.length)}.json.br`,
  };
}

function hashRawJson(rawJson: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(rawJson).digest('hex')}`;
}
