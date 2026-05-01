import { Buffer } from 'node:buffer';
import { gzipSync, gunzipSync } from 'node:zlib';
import type {
  CacheRecording,
  CacheRecordingOp,
  SerializedCacheSpan,
} from '@agent-evals/shared';

const serializedCacheValueMarker = '__aecs';
const legacySerializedCacheValueMarker = '__agentEvalsCacheSerialization';
const jsonSafeCacheValueVersion = 'json-safe-v1';
const packedNumberArrayMinLength = 128;
const compressedStringMinBytes = 16 * 1024;
const compressedJsonMinBytes = 64 * 1024;
const maxCompressedSizeRatio = 0.8;

type JsonSafeCacheValueType =
  | 'ArrayBuffer'
  | 'BigInt'
  | 'Blob'
  | 'CompressedJson'
  | 'CompressedString'
  | 'Date'
  | 'Error'
  | 'File'
  | 'Float64Array'
  | 'Headers'
  | 'Map'
  | 'Number'
  | 'Object'
  | 'RegExp'
  | 'Set'
  | 'URL'
  | 'URLSearchParams'
  | 'Undefined';

type JsonSafeSerializedCacheValue = {
  [serializedCacheValueMarker]: typeof jsonSafeCacheValueVersion;
  codec?: 'gzip';
  length?: number;
  type: JsonSafeCacheValueType;
  value?: unknown;
};

/** JSON-safe persisted representation for one rich cached value. */
export type SerializedCacheValue = JsonSafeSerializedCacheValue;

/** Options controlling how rich cache values are persisted as JSON-safe data. */
export type CacheSerializationOptions = {
  /**
   * Preserve JavaScript `undefined` values with explicit tagged wrappers.
   *
   * Disabled by default so undefined object fields, array items, map entries,
   * and set items are omitted instead of being written to cache files.
   */
  preserveUndefined?: boolean;
};

type CacheSerializationConfig = { preserveUndefined: boolean };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSafeSerializedCacheValue(
  value: unknown,
): value is JsonSafeSerializedCacheValue {
  return (
    isRecordLike(value) &&
    serializationMarkerValue(value) === jsonSafeCacheValueVersion &&
    typeof value.type === 'string'
  );
}

function jsonSafeValue(
  type: JsonSafeCacheValueType,
  value?: unknown,
): JsonSafeSerializedCacheValue {
  return value === undefined
    ? { [serializedCacheValueMarker]: jsonSafeCacheValueVersion, type }
    : { [serializedCacheValueMarker]: jsonSafeCacheValueVersion, type, value };
}

function hasSerializationMarkerKey(value: object): boolean {
  return (
    Object.hasOwn(value, serializedCacheValueMarker) ||
    Object.hasOwn(value, legacySerializedCacheValueMarker)
  );
}

function serializationMarkerValue(value: Record<string, unknown>): unknown {
  return (
    value[serializedCacheValueMarker] ?? value[legacySerializedCacheValueMarker]
  );
}

/**
 * Serialize one cached value while keeping plain JSON as plain JSON.
 *
 * Rich runtime values use small tagged wrappers. Undefined values are omitted
 * by default; pass `preserveUndefined: true` to round-trip them explicitly.
 */
export async function serializeCacheValue(
  value: unknown,
  options: CacheSerializationOptions | undefined = undefined,
): Promise<unknown> {
  return serializeJsonSafeValue(
    value,
    new WeakSet(),
    0,
    normalizeCacheSerializationOptions(options),
  );
}

/** Revive one cached value, while preserving legacy JSON-round-tripped data. */
export function deserializeCacheValue(value: unknown): unknown {
  return deserializeJsonSafeValue(value);
}

/** Clone one value through the same serialization path used for cache data. */
export async function cloneCacheValue(
  value: unknown,
  options: CacheSerializationOptions | undefined = undefined,
): Promise<unknown> {
  return deserializeCacheValue(await serializeCacheValue(value, options));
}

function normalizeCacheSerializationOptions(
  options: CacheSerializationOptions | undefined,
): CacheSerializationConfig {
  return { preserveUndefined: options?.preserveUndefined === true };
}

async function serializeJsonSafeValue(
  value: unknown,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<unknown> {
  if (value === undefined) {
    return config.preserveUndefined ? jsonSafeValue('Undefined') : undefined;
  }
  if (typeof value === 'bigint')
    return jsonSafeValue('BigInt', value.toString());
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'string') return serializeString(value, depth);
  if (value instanceof Date) return jsonSafeValue('Date', value.toISOString());
  if (value instanceof Map) return serializeMap(value, refs, depth, config);
  if (value instanceof Set) return serializeSet(value, refs, depth, config);
  if (value instanceof RegExp) {
    return jsonSafeValue('RegExp', {
      flags: value.flags,
      source: value.source,
    });
  }
  if (value instanceof URL) return jsonSafeValue('URL', value.toString());
  if (value instanceof URLSearchParams) {
    return jsonSafeValue('URLSearchParams', value.toString());
  }
  if (value instanceof Headers) {
    return jsonSafeValue('Headers', [...value.entries()]);
  }
  if (value instanceof File) {
    return jsonSafeValue('File', {
      bytes: await blobToBase64(value),
      lastModified: value.lastModified,
      name: value.name,
      type: value.type,
    });
  }
  if (value instanceof Blob) {
    return jsonSafeValue('Blob', {
      bytes: await blobToBase64(value),
      type: value.type,
    });
  }
  if (value instanceof ArrayBuffer) {
    return jsonSafeValue('ArrayBuffer', bytesToBase64(new Uint8Array(value)));
  }
  if (value instanceof Error) return serializeError(value, refs, depth, config);
  if (!value || typeof value !== 'object') return value;

  if (refs.has(value)) {
    throw new Error('Circular cache values are not supported');
  }

  refs.add(value);
  if (Array.isArray(value)) {
    if (
      depth > 0 &&
      value.length >= packedNumberArrayMinLength &&
      isDenseNumberArray(value)
    ) {
      const packed = packNumberArray(value);
      if (packed !== undefined) {
        refs.delete(value);
        return packed;
      }
    }

    const items: unknown[] = [];
    for (const item of value) {
      const serializedItem = await serializeJsonSafeValue(
        item,
        refs,
        depth + 1,
        config,
      );
      if (serializedItem !== undefined) items.push(serializedItem);
    }
    refs.delete(value);
    return compressNestedJsonValue(items, depth) ?? items;
  }

  const entries: [string, unknown][] = [];
  for (const [key, entryValue] of Object.entries(value)) {
    const serializedEntryValue = await serializeJsonSafeValue(
      entryValue,
      refs,
      depth + 1,
      config,
    );
    if (serializedEntryValue !== undefined) {
      entries.push([key, serializedEntryValue]);
    }
  }
  refs.delete(value);

  const serialized = hasSerializationMarkerKey(value)
    ? jsonSafeValue('Object', entries)
    : Object.fromEntries(entries);
  return compressNestedJsonValue(serialized, depth) ?? serialized;
}

function serializeNumber(value: number): unknown {
  if (Number.isNaN(value)) return jsonSafeValue('Number', 'NaN');
  if (value === Infinity) return jsonSafeValue('Number', 'Infinity');
  if (value === -Infinity) return jsonSafeValue('Number', '-Infinity');
  if (Object.is(value, -0)) return jsonSafeValue('Number', '-0');
  return value;
}

function serializeString(value: string, depth: number): unknown {
  if (depth === 0) return value;
  return compressNestedStringValue(value) ?? value;
}

function isDenseNumberArray(value: unknown[]): value is number[] {
  for (let index = 0; index < value.length; index++) {
    if (typeof value[index] !== 'number') return false;
  }
  return true;
}

function encodeFloat64Array(value: number[]): string {
  const bytes = new ArrayBuffer(value.length * 8);
  const view = new DataView(bytes);
  for (const [index, item] of value.entries()) {
    view.setFloat64(index * 8, item, true);
  }
  return bytesToBase64(new Uint8Array(bytes));
}

function packNumberArray(
  value: number[],
): JsonSafeSerializedCacheValue | undefined {
  const serialized = {
    [serializedCacheValueMarker]: jsonSafeCacheValueVersion,
    length: value.length,
    type: 'Float64Array',
    value: encodeFloat64Array(value),
  } satisfies JsonSafeSerializedCacheValue;
  return compressionIsWorthIt(
    serialized,
    Buffer.byteLength(JSON.stringify(value)),
  )
    ? serialized
    : undefined;
}

function decodeFloat64Array(value: string, length: number): number[] {
  const bytes = base64ToArrayBuffer(value);
  const view = new DataView(bytes);
  return Array.from({ length }, (_, index) => view.getFloat64(index * 8, true));
}

function compressNestedStringValue(
  value: string,
): JsonSafeSerializedCacheValue | undefined {
  const rawSize = Buffer.byteLength(JSON.stringify(value));
  if (rawSize < compressedStringMinBytes) return undefined;
  const compressed = gzipSync(value);
  const serialized = {
    [serializedCacheValueMarker]: jsonSafeCacheValueVersion,
    codec: 'gzip',
    length: Buffer.byteLength(value),
    type: 'CompressedString',
    value: compressed.toString('base64'),
  } satisfies JsonSafeSerializedCacheValue;
  return compressionIsWorthIt(serialized, rawSize) ? serialized : undefined;
}

function compressNestedJsonValue(
  value: unknown,
  depth: number,
): JsonSafeSerializedCacheValue | undefined {
  if (depth === 0) return undefined;
  const raw = JSON.stringify(value);
  const rawSize = Buffer.byteLength(raw);
  if (rawSize < compressedJsonMinBytes) return undefined;
  const serialized = {
    [serializedCacheValueMarker]: jsonSafeCacheValueVersion,
    codec: 'gzip',
    length: rawSize,
    type: 'CompressedJson',
    value: gzipSync(raw).toString('base64'),
  } satisfies JsonSafeSerializedCacheValue;
  return compressionIsWorthIt(serialized, rawSize) ? serialized : undefined;
}

function compressionIsWorthIt(
  value: JsonSafeSerializedCacheValue,
  rawSize: number,
): boolean {
  return (
    Buffer.byteLength(JSON.stringify(value)) < rawSize * maxCompressedSizeRatio
  );
}

async function serializeMap(
  value: Map<unknown, unknown>,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<unknown> {
  if (refs.has(value)) {
    throw new Error('Circular cache values are not supported');
  }

  refs.add(value);
  const entries: unknown[] = [];
  for (const [key, entryValue] of value.entries()) {
    const serializedKey = await serializeJsonSafeValue(
      key,
      refs,
      depth + 1,
      config,
    );
    const serializedEntryValue = await serializeJsonSafeValue(
      entryValue,
      refs,
      depth + 1,
      config,
    );
    if (serializedKey !== undefined && serializedEntryValue !== undefined) {
      entries.push([serializedKey, serializedEntryValue]);
    }
  }
  refs.delete(value);
  return jsonSafeValue('Map', entries);
}

async function serializeSet(
  value: Set<unknown>,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<unknown> {
  if (refs.has(value)) {
    throw new Error('Circular cache values are not supported');
  }

  refs.add(value);
  const items: unknown[] = [];
  for (const item of value.values()) {
    const serializedItem = await serializeJsonSafeValue(
      item,
      refs,
      depth + 1,
      config,
    );
    if (serializedItem !== undefined) items.push(serializedItem);
  }
  refs.delete(value);
  return jsonSafeValue('Set', items);
}

async function serializeError(
  value: Error,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<unknown> {
  if (refs.has(value)) {
    throw new Error('Circular cache values are not supported');
  }

  refs.add(value);
  const props: [string, unknown][] = [];
  for (const [key, entryValue] of Object.entries(value)) {
    if (key === 'cause') continue;
    const serializedEntryValue = await serializeJsonSafeValue(
      entryValue,
      refs,
      depth + 1,
      config,
    );
    if (serializedEntryValue !== undefined) {
      props.push([key, serializedEntryValue]);
    }
  }
  const serialized = jsonSafeValue('Error', {
    cause:
      'cause' in value
        ? await serializeJsonSafeValue(value.cause, refs, depth + 1, config)
        : undefined,
    message: value.message,
    name: value.name,
    props,
    stack: value.stack,
  });
  refs.delete(value);
  return serialized;
}

async function blobToBase64(value: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await value.arrayBuffer()));
}

function bytesToBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const source = Buffer.from(value, 'base64');
  const target = new ArrayBuffer(source.byteLength);
  new Uint8Array(target).set(source);
  return target;
}

function deserializeJsonSafeValue(value: unknown): unknown {
  if (isJsonSafeSerializedCacheValue(value)) {
    return deserializeJsonSafeWrapper(value);
  }
  if (Array.isArray(value)) return value.map(deserializeJsonSafeValue);
  if (!isRecordLike(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      deserializeJsonSafeValue(entryValue),
    ]),
  );
}

function deserializeJsonSafeWrapper(
  value: JsonSafeSerializedCacheValue,
): unknown {
  switch (value.type) {
    case 'ArrayBuffer':
      return deserializeArrayBuffer(value.value);
    case 'BigInt':
      return typeof value.value === 'string'
        ? BigInt(value.value)
        : value.value;
    case 'Blob':
      return deserializeBlob(value.value);
    case 'CompressedJson':
      return deserializeCompressedJson(value.value);
    case 'CompressedString':
      return deserializeCompressedString(value.value);
    case 'Date':
      return typeof value.value === 'string'
        ? new Date(value.value)
        : value.value;
    case 'Error':
      return deserializeError(value.value);
    case 'File':
      return deserializeFile(value.value);
    case 'Float64Array':
      return deserializeFloat64Array(value.value, value.length);
    case 'Headers':
      return new Headers(deserializeStringPairArray(value.value));
    case 'Map':
      return new Map(deserializePairArray(value.value));
    case 'Number':
      return deserializeNumber(value.value);
    case 'Object':
      return Object.fromEntries(deserializeStringValuePairArray(value.value));
    case 'RegExp':
      return deserializeRegExp(value.value);
    case 'Set':
      return new Set(deserializeArray(value.value));
    case 'URL':
      return typeof value.value === 'string'
        ? new URL(value.value)
        : value.value;
    case 'URLSearchParams':
      return typeof value.value === 'string'
        ? new URLSearchParams(value.value)
        : value.value;
    case 'Undefined':
      return undefined;
  }
}

function deserializeNumber(value: unknown): unknown {
  if (value === 'NaN') return NaN;
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;
  if (value === '-0') return -0;
  return value;
}

function deserializeCompressedString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return gunzipSync(Buffer.from(value, 'base64')).toString('utf8');
}

function deserializeCompressedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return deserializeJsonSafeValue(
    JSON.parse(gunzipSync(Buffer.from(value, 'base64')).toString('utf8')),
  );
}

function deserializeFloat64Array(value: unknown, length: unknown): unknown {
  if (typeof value !== 'string' || typeof length !== 'number') return value;
  return decodeFloat64Array(value, length);
}

function deserializePairArray(value: unknown): [unknown, unknown][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) return [];
    return [
      [deserializeJsonSafeValue(entry[0]), deserializeJsonSafeValue(entry[1])],
    ];
  });
}

function deserializeStringPairArray(value: unknown): [string, string][] {
  return deserializePairArray(value).flatMap(([key, entryValue]) => {
    if (typeof key !== 'string' || typeof entryValue !== 'string') return [];
    return [[key, entryValue]];
  });
}

function deserializeStringValuePairArray(value: unknown): [string, unknown][] {
  return deserializePairArray(value).flatMap(([key, entryValue]) => {
    if (typeof key !== 'string') return [];
    return [[key, entryValue]];
  });
}

function deserializeArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map(deserializeJsonSafeValue);
}

function deserializeRegExp(value: unknown): unknown {
  if (!isRecordLike(value)) return value;
  const source = value.source;
  const flags = value.flags;
  if (typeof source !== 'string' || typeof flags !== 'string') return value;
  return new RegExp(source, flags);
}

function deserializeArrayBuffer(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return base64ToArrayBuffer(value);
}

function deserializeBlob(value: unknown): unknown {
  if (!isRecordLike(value)) return value;
  const bytes = value.bytes;
  const type = value.type;
  if (typeof bytes !== 'string' || typeof type !== 'string') return value;
  return new Blob([base64ToArrayBuffer(bytes)], { type });
}

function deserializeFile(value: unknown): unknown {
  if (!isRecordLike(value)) return value;
  const bytes = value.bytes;
  const lastModified = value.lastModified;
  const name = value.name;
  const type = value.type;
  if (
    typeof bytes !== 'string' ||
    typeof lastModified !== 'number' ||
    typeof name !== 'string' ||
    typeof type !== 'string'
  ) {
    return value;
  }
  return new File([new Blob([base64ToArrayBuffer(bytes)], { type })], name, {
    lastModified,
    type,
  });
}

function deserializeError(value: unknown): unknown {
  if (!isRecordLike(value)) return value;
  const message = value.message;
  const error = new Error(typeof message === 'string' ? message : undefined);
  if (typeof value.name === 'string') error.name = value.name;
  if (typeof value.stack === 'string') error.stack = value.stack;
  if (value.cause !== undefined) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      enumerable: false,
      value: deserializeJsonSafeValue(value.cause),
      writable: true,
    });
  }
  for (const [key, entryValue] of deserializeStringValuePairArray(
    value.props,
  )) {
    Object.defineProperty(error, key, {
      configurable: true,
      enumerable: true,
      value: entryValue,
      writable: true,
    });
  }
  return error;
}

async function serializeRecordValues(
  record: Record<string, unknown>,
  config: CacheSerializationConfig,
): Promise<Record<string, unknown>> {
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(record)) {
    const serializedValue = await serializeCacheValue(value, config);
    if (serializedValue !== undefined) entries.push([key, serializedValue]);
  }
  return Object.fromEntries(entries);
}

function deserializeRecordValues(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      deserializeCacheValue(value),
    ]),
  );
}

async function serializeCacheRecordingOp(
  op: CacheRecordingOp,
  config: CacheSerializationConfig,
): Promise<CacheRecordingOp> {
  switch (op.kind) {
    case 'setOutput':
    case 'appendOutput':
      return { ...op, value: await serializeCacheValue(op.value, config) };
    case 'mergeOutput':
      return { ...op, patch: await serializeRecordValues(op.patch, config) };
    case 'incrementOutput':
      return op;
    case 'checkpoint':
      return { ...op, data: await serializeCacheValue(op.data, config) };
    case 'subSpan':
      return { ...op, span: await serializeCacheSpan(op.span, config) };
  }
}

function deserializeCacheRecordingOp(op: CacheRecordingOp): CacheRecordingOp {
  switch (op.kind) {
    case 'setOutput':
    case 'appendOutput':
      return { ...op, value: deserializeCacheValue(op.value) };
    case 'mergeOutput':
      return { ...op, patch: deserializeRecordValues(op.patch) };
    case 'incrementOutput':
      return op;
    case 'checkpoint':
      return { ...op, data: deserializeCacheValue(op.data) };
    case 'subSpan':
      return { ...op, span: deserializeCacheSpan(op.span) };
  }
}

async function serializeCacheSpan(
  span: SerializedCacheSpan,
  config: CacheSerializationConfig,
): Promise<SerializedCacheSpan> {
  return {
    ...span,
    attributes:
      span.attributes === undefined
        ? undefined
        : await serializeRecordValues(span.attributes, config),
    children: await Promise.all(
      span.children.map((child) => serializeCacheSpan(child, config)),
    ),
  };
}

function deserializeCacheSpan(span: SerializedCacheSpan): SerializedCacheSpan {
  return {
    ...span,
    attributes:
      span.attributes === undefined
        ? undefined
        : deserializeRecordValues(span.attributes),
    children: span.children.map(deserializeCacheSpan),
  };
}

/**
 * Serialize all rich values captured in a cache recording before persistence.
 *
 * Undefined values are omitted by default; pass `preserveUndefined: true` to
 * retain the legacy explicit undefined wrappers in the recording payload.
 */
export async function serializeCacheRecording(
  recording: CacheRecording,
  options: CacheSerializationOptions | undefined = undefined,
): Promise<CacheRecording> {
  const config = normalizeCacheSerializationOptions(options);
  return {
    ...recording,
    returnValue: await serializeCacheValue(recording.returnValue, config),
    finalAttributes: await serializeRecordValues(
      recording.finalAttributes,
      config,
    ),
    ops: await Promise.all(
      recording.ops.map((op) => serializeCacheRecordingOp(op, config)),
    ),
  };
}

/** Revive all rich values captured in a cache recording after lookup. */
export function deserializeCacheRecording(
  recording: CacheRecording,
): CacheRecording {
  return {
    ...recording,
    returnValue: deserializeCacheValue(recording.returnValue),
    finalAttributes: deserializeRecordValues(recording.finalAttributes),
    ops: recording.ops.map(deserializeCacheRecordingOp),
  };
}
