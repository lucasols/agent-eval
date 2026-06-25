import { Buffer } from 'node:buffer';
import type {
  CacheRecording,
  CacheRecordingOp,
  SerializedCacheSpan,
} from '@agent-evals/shared';

const serializedCacheValueMarker = '__aecs';
const jsonSafeCacheValueVersion = 'v1';
const packedNumberArrayMinLength = 128;
const maxPackedNumberArraySizeRatio = 0.8;
const externalJsonMinChars = 10 * 1024;
const jsonSafeCacheValueTypes = new Set<string>(
  'ArrayBuffer ArrayBufferView BigInt Blob Date Error ExternalJson File Float64Array Headers Map Number Object RegExp Set URL URLSearchParams Undefined'.split(
    ' ',
  ),
);

type JsonSafeCacheValueType =
  | 'ArrayBuffer'
  | 'ArrayBufferView'
  | 'BigInt'
  | 'Blob'
  | 'Date'
  | 'Error'
  | 'ExternalJson'
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
  [serializedCacheValueMarker]: `v1:${JsonSafeCacheValueType}`;
  compressedLength?: number;
  hash?: string;
  length?: number;
  path?: string;
  value?: unknown;
};

/** JSON-safe persisted representation for one rich cached value. */
export type SerializedCacheValue = JsonSafeSerializedCacheValue;

/** Metadata for a Brotli-compressed external JSON blob. */
export type ExternalJsonBlobRef = {
  /** Original UTF-8 JSON byte length. */
  length: number;
  /** Brotli-compressed byte length. */
  compressedLength: number;
  /** SHA-256 digest of the original UTF-8 JSON payload. */
  hash: `sha256:${string}`;
  /** Store-relative Brotli blob path. */
  path: string;
};

/** Store used by cache serialization for large nested JSON values. */
export type CacheSerializationExternalJsonStore = {
  /** Persist canonical JSON and return its content-addressed ref. */
  write(rawJson: string): Promise<ExternalJsonBlobRef>;
  /** Read a previously persisted canonical JSON payload. */
  read(ref: ExternalJsonBlobRef): Promise<string>;
};

/** Options controlling how rich cache values are persisted as JSON-safe data. */
export type CacheSerializationOptions = {
  /** Preserve JavaScript `undefined` values with explicit tagged wrappers. */
  preserveUndefined?: boolean;
  /** Externalize large nested JSON values through Brotli blob refs. */
  compress?: boolean;
  /** Store used for large nested JSON values when `compress` is enabled. */
  externalJsonStore?: CacheSerializationExternalJsonStore;
};

type CacheSerializationConfig = {
  compress: boolean;
  externalJsonStore: CacheSerializationExternalJsonStore | undefined;
  preserveUndefined: boolean;
};

type SerializedJsonSafeValueResult = { value: unknown; jsonLength: number };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSafeSerializedCacheValue(
  value: unknown,
): value is JsonSafeSerializedCacheValue {
  return isRecordLike(value) && jsonSafeValueType(value) !== undefined;
}

function jsonSafeValue(
  type: JsonSafeCacheValueType,
  value?: unknown,
): JsonSafeSerializedCacheValue {
  return value === undefined
    ? { [serializedCacheValueMarker]: jsonSafeMarker(type) }
    : { [serializedCacheValueMarker]: jsonSafeMarker(type), value };
}

function hasSerializationMarkerKey(value: object): boolean {
  return Object.hasOwn(value, serializedCacheValueMarker);
}

function jsonSafeMarker(
  type: JsonSafeCacheValueType,
): `v1:${JsonSafeCacheValueType}` {
  return `${jsonSafeCacheValueVersion}:${type}`;
}

function jsonSafeValueType(
  value: Record<string, unknown>,
): JsonSafeCacheValueType | undefined {
  const marker = value[serializedCacheValueMarker];
  if (typeof marker !== 'string') return undefined;
  if (!marker.startsWith(`${jsonSafeCacheValueVersion}:`)) return undefined;
  const type = marker.slice(jsonSafeCacheValueVersion.length + 1);
  return isJsonSafeCacheValueType(type) ? type : undefined;
}

function isJsonSafeCacheValueType(
  value: string,
): value is JsonSafeCacheValueType {
  return jsonSafeCacheValueTypes.has(value);
}

function externalJsonRefFromWrapper(
  value: JsonSafeSerializedCacheValue,
): ExternalJsonBlobRef | undefined {
  const hash =
    typeof value.hash === 'string' ? toExternalJsonHash(value.hash) : undefined;
  if (
    hash === undefined ||
    typeof value.length !== 'number' ||
    typeof value.compressedLength !== 'number' ||
    typeof value.path !== 'string'
  ) {
    return undefined;
  }
  return {
    compressedLength: value.compressedLength,
    hash,
    length: value.length,
    path: value.path,
  };
}

function toExternalJsonHash(value: string): `sha256:${string}` | undefined {
  if (!value.startsWith('sha256:')) return undefined;
  return `sha256:${value.slice('sha256:'.length)}`;
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
  return (
    await serializeJsonSafeValue(
      value,
      new WeakSet(),
      0,
      normalizeCacheSerializationOptions(options),
    )
  ).value;
}

function serializedResult(
  value: unknown,
  jsonLength = jsonLengthOfSerializedValue(value),
): SerializedJsonSafeValueResult {
  return { value, jsonLength };
}

function jsonLengthOfSerializedValue(value: unknown): number {
  if (value === undefined) return 0;
  if (value === null) return 4;
  if (typeof value === 'string') return approximateJsonStringLength(value);
  return JSON.stringify(value).length;
}

function approximateJsonStringLength(value: string): number {
  return value.length + 2;
}

function jsonArrayLength(itemLengths: number[]): number {
  return (
    2 +
    itemLengths.reduce((total, itemLength) => total + itemLength, 0) +
    Math.max(itemLengths.length - 1, 0)
  );
}

function jsonObjectLength(entries: Array<[string, number]>): number {
  return (
    2 +
    entries.reduce(
      (total, [key, valueLength]) =>
        total + approximateJsonStringLength(key) + 1 + valueLength,
      0,
    ) +
    Math.max(entries.length - 1, 0)
  );
}

async function serializeJsonSafeValue(
  value: unknown,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<SerializedJsonSafeValueResult> {
  if (value === undefined) {
    return config.preserveUndefined
      ? serializedResult(jsonSafeValue('Undefined'))
      : serializedResult(undefined);
  }
  if (typeof value === 'bigint') {
    return serializedResult(jsonSafeValue('BigInt', value.toString()));
  }
  if (typeof value === 'number')
    return serializedResult(serializeNumber(value));
  if (typeof value === 'string') {
    return await externalizeNestedJsonValue(
      serializedResult(value, approximateJsonStringLength(value)),
      depth,
      config,
    );
  }
  if (value instanceof Date) {
    return serializedResult(jsonSafeValue('Date', value.toISOString()));
  }
  if (value instanceof Map) return serializeMap(value, refs, depth, config);
  if (value instanceof Set) return serializeSet(value, refs, depth, config);
  if (value instanceof RegExp) {
    return serializedResult(
      jsonSafeValue('RegExp', { flags: value.flags, source: value.source }),
    );
  }
  if (value instanceof URL) {
    return serializedResult(jsonSafeValue('URL', value.toString()));
  }
  if (value instanceof URLSearchParams) {
    return serializedResult(jsonSafeValue('URLSearchParams', value.toString()));
  }
  if (value instanceof Headers) {
    return serializedResult(jsonSafeValue('Headers', [...value.entries()]));
  }
  if (value instanceof File) {
    return serializedResult(
      jsonSafeValue('File', {
        bytes: await blobToBase64(value),
        lastModified: value.lastModified,
        name: value.name,
        type: value.type,
      }),
    );
  }
  if (value instanceof Blob) {
    return serializedResult(
      jsonSafeValue('Blob', {
        bytes: await blobToBase64(value),
        type: value.type,
      }),
    );
  }
  if (value instanceof ArrayBuffer) {
    return serializedResult(
      jsonSafeValue('ArrayBuffer', bytesToBase64(new Uint8Array(value))),
    );
  }
  if (ArrayBuffer.isView(value)) {
    return serializedResult(serializeArrayBufferView(value));
  }
  if (value instanceof Error) return serializeError(value, refs, depth, config);
  if (!value || typeof value !== 'object') return serializedResult(value);

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
        return serializedResult(packed);
      }
    }

    const items: unknown[] = [];
    const itemLengths: number[] = [];
    for (const item of value) {
      const serializedItem = await serializeJsonSafeValue(
        item,
        refs,
        depth + 1,
        config,
      );
      if (serializedItem.value !== undefined) {
        items.push(serializedItem.value);
        itemLengths.push(serializedItem.jsonLength);
      }
    }
    refs.delete(value);
    return await externalizeNestedJsonValue(
      serializedResult(items, jsonArrayLength(itemLengths)),
      depth,
      config,
    );
  }

  const entries: [string, unknown][] = [];
  const entryLengths: Array<[string, number]> = [];
  for (const [key, entryValue] of Object.entries(value)) {
    const serializedEntryValue = await serializeJsonSafeValue(
      entryValue,
      refs,
      depth + 1,
      config,
    );
    if (serializedEntryValue.value !== undefined) {
      entries.push([key, serializedEntryValue.value]);
      entryLengths.push([key, serializedEntryValue.jsonLength]);
    }
  }
  refs.delete(value);

  if (hasSerializationMarkerKey(value)) {
    const serialized = jsonSafeValue('Object', entries);
    return await externalizeNestedJsonValue(
      serializedResult(serialized),
      depth,
      config,
    );
  }

  const serialized = Object.fromEntries(entries);
  return await externalizeNestedJsonValue(
    serializedResult(serialized, jsonObjectLength(entryLengths)),
    depth,
    config,
  );
}

/** Revive one cached value, while preserving legacy JSON-round-tripped data. */
export function deserializeCacheValue(value: unknown): unknown {
  return deserializeJsonSafeValue(value);
}

/** Replace external JSON blob refs with their parsed serialized payloads. */
export async function materializeExternalJsonValues(
  value: unknown,
  store: CacheSerializationExternalJsonStore,
): Promise<unknown> {
  if (
    isJsonSafeSerializedCacheValue(value) &&
    jsonSafeValueType(value) === 'ExternalJson'
  ) {
    const ref = externalJsonRefFromWrapper(value);
    if (ref === undefined) return value;
    return materializeExternalJsonValues(
      JSON.parse(await store.read(ref)),
      store,
    );
  }
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) => materializeExternalJsonValues(item, store)),
    );
  }
  if (!isRecordLike(value)) return value;

  return Object.fromEntries(
    await Promise.all(
      Object.entries(value).map(async ([key, entryValue]) => [
        key,
        await materializeExternalJsonValues(entryValue, store),
      ]),
    ),
  );
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
  return {
    compress: options?.compress !== false,
    externalJsonStore: options?.externalJsonStore,
    preserveUndefined: options?.preserveUndefined === true,
  };
}

function serializeNumber(value: number): unknown {
  if (Number.isNaN(value)) return jsonSafeValue('Number', 'NaN');
  if (value === Infinity) return jsonSafeValue('Number', 'Infinity');
  if (value === -Infinity) return jsonSafeValue('Number', '-Infinity');
  if (Object.is(value, -0)) return jsonSafeValue('Number', '-0');
  return value;
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
    [serializedCacheValueMarker]: jsonSafeMarker('Float64Array'),
    length: value.length,
    value: encodeFloat64Array(value),
  } satisfies JsonSafeSerializedCacheValue;
  return JSON.stringify(serialized).length <
    JSON.stringify(value).length * maxPackedNumberArraySizeRatio
    ? serialized
    : undefined;
}

function decodeFloat64Array(value: string, length: number): number[] {
  const bytes = base64ToArrayBuffer(value);
  const view = new DataView(bytes);
  return Array.from({ length }, (_, index) => view.getFloat64(index * 8, true));
}

function serializeArrayBufferView(
  value: ArrayBufferView,
): JsonSafeSerializedCacheValue {
  const bytes = new Uint8Array(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  );
  return jsonSafeValue('ArrayBufferView', {
    bytes: bytesToBase64(bytes),
    type: Buffer.isBuffer(value) ? 'Buffer' : value.constructor.name,
  });
}

async function externalizeNestedJsonValue(
  result: SerializedJsonSafeValueResult,
  depth: number,
  config: CacheSerializationConfig,
): Promise<SerializedJsonSafeValueResult> {
  if (
    depth === 0 ||
    !config.compress ||
    config.externalJsonStore === undefined ||
    result.jsonLength < externalJsonMinChars
  ) {
    return result;
  }

  const raw = JSON.stringify(result.value);
  if (raw.length < externalJsonMinChars) {
    return { ...result, jsonLength: raw.length };
  }

  const ref = await config.externalJsonStore.write(raw);
  return serializedResult({
    [serializedCacheValueMarker]: jsonSafeMarker('ExternalJson'),
    compressedLength: ref.compressedLength,
    hash: ref.hash,
    length: ref.length,
    path: ref.path,
  } satisfies JsonSafeSerializedCacheValue);
}

async function serializeMap(
  value: Map<unknown, unknown>,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<SerializedJsonSafeValueResult> {
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
    if (
      serializedKey.value !== undefined &&
      serializedEntryValue.value !== undefined
    ) {
      entries.push([serializedKey.value, serializedEntryValue.value]);
    }
  }
  refs.delete(value);
  return serializedResult(jsonSafeValue('Map', entries));
}

async function serializeSet(
  value: Set<unknown>,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<SerializedJsonSafeValueResult> {
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
    if (serializedItem.value !== undefined) items.push(serializedItem.value);
  }
  refs.delete(value);
  return serializedResult(jsonSafeValue('Set', items));
}

async function serializeError(
  value: Error,
  refs: WeakSet<object>,
  depth: number,
  config: CacheSerializationConfig,
): Promise<SerializedJsonSafeValueResult> {
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
    if (serializedEntryValue.value !== undefined) {
      props.push([key, serializedEntryValue.value]);
    }
  }
  const cause =
    'cause' in value
      ? (await serializeJsonSafeValue(value.cause, refs, depth + 1, config))
          .value
      : undefined;
  const serialized = jsonSafeValue('Error', {
    cause,
    message: value.message,
    name: value.name,
    props,
    stack: value.stack,
  });
  refs.delete(value);
  return serializedResult(serialized);
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
  switch (jsonSafeValueType(value)) {
    case 'ArrayBuffer':
      return deserializeArrayBuffer(value.value);
    case 'ArrayBufferView':
      return deserializeArrayBufferView(value.value);
    case 'BigInt':
      return typeof value.value === 'string'
        ? BigInt(value.value)
        : value.value;
    case 'Blob':
      return deserializeBlob(value.value);
    case 'Date':
      return typeof value.value === 'string'
        ? new Date(value.value)
        : value.value;
    case 'Error':
      return deserializeError(value.value);
    case 'ExternalJson':
      return value;
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
    default:
      return value;
  }
}

function deserializeNumber(value: unknown): unknown {
  if (value === 'NaN') return NaN;
  if (value === 'Infinity') return Infinity;
  if (value === '-Infinity') return -Infinity;
  if (value === '-0') return -0;
  return value;
}

function deserializeFloat64Array(value: unknown, length: unknown): unknown {
  if (typeof value !== 'string' || typeof length !== 'number') return value;
  return decodeFloat64Array(value, length);
}

function deserializeArrayBufferView(value: unknown): unknown {
  if (!isRecordLike(value)) return value;
  const bytes = value.bytes;
  const type = value.type;
  if (typeof bytes !== 'string' || typeof type !== 'string') return value;
  const buffer = base64ToArrayBuffer(bytes);
  switch (type) {
    case 'BigInt64Array':
      return buffer.byteLength % BigInt64Array.BYTES_PER_ELEMENT === 0
        ? new BigInt64Array(buffer)
        : value;
    case 'BigUint64Array':
      return buffer.byteLength % BigUint64Array.BYTES_PER_ELEMENT === 0
        ? new BigUint64Array(buffer)
        : value;
    case 'Buffer':
      return Buffer.from(buffer);
    case 'DataView':
      return new DataView(buffer);
    case 'Float32Array':
      return buffer.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
        ? new Float32Array(buffer)
        : value;
    case 'Float64Array':
      return buffer.byteLength % Float64Array.BYTES_PER_ELEMENT === 0
        ? new Float64Array(buffer)
        : value;
    case 'Int8Array':
      return new Int8Array(buffer);
    case 'Int16Array':
      return buffer.byteLength % Int16Array.BYTES_PER_ELEMENT === 0
        ? new Int16Array(buffer)
        : value;
    case 'Int32Array':
      return buffer.byteLength % Int32Array.BYTES_PER_ELEMENT === 0
        ? new Int32Array(buffer)
        : value;
    case 'Uint8Array':
      return new Uint8Array(buffer);
    case 'Uint8ClampedArray':
      return new Uint8ClampedArray(buffer);
    case 'Uint16Array':
      return buffer.byteLength % Uint16Array.BYTES_PER_ELEMENT === 0
        ? new Uint16Array(buffer)
        : value;
    case 'Uint32Array':
      return buffer.byteLength % Uint32Array.BYTES_PER_ELEMENT === 0
        ? new Uint32Array(buffer)
        : value;
    default:
      return value;
  }
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
