import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { getCompositeKey } from '@ls-stack/utils/getCompositeKey';

/** Components folded into a deterministic cache key hash. */
export type CacheKeyHashInput = {
  /** Cache namespace, usually derived from the eval id and operation name. */
  namespace: string;
  /** User-authored cache key value. */
  key: unknown;
};

/** Optional controls for cache key hashing. */
export type CacheKeyHashOptions = {
  /**
   * When true, native `Blob` and `File` values are read asynchronously and
   * hashed by bytes plus stable metadata. Defaults to metadata-only hashing.
   */
  serializeFileBytes?: boolean;
};

type CacheKeyDebugBinaryValue = {
  __agentEvalsCacheKeyBinary: 'v1';
  byteLength: number;
  sha256: `sha256:${string}`;
  type: string;
};

type CacheKeyDebugBlobValue = {
  __agentEvalsCacheKeyBlob: 'v1';
  lastModified?: number;
  name?: string;
  size: number;
  type: string;
};

class SerializedCacheKeyValue {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

/**
 * Hash the components of a cache key into a deterministic hex digest.
 *
 * Native `Blob` and `File` values use stable metadata by default. Pass
 * `serializeFileBytes: true` to read them asynchronously and include their byte
 * hash in the key.
 */
export async function hashCacheKey(
  input: CacheKeyHashInput,
  options: CacheKeyHashOptions = {},
): Promise<string> {
  const materialized =
    options.serializeFileBytes === true
      ? await materializeAsyncCacheKeyValue(input)
      : input;
  return hashCacheKeySyncMaterialized(materialized);
}

/**
 * Synchronously hash cache key components. This supports JSON-like data and
 * in-memory binary values such as `Buffer`, `ArrayBuffer`, and typed arrays,
 * plus stable metadata for native `Blob` and `File` values.
 */
export function hashCacheKeySync(input: CacheKeyHashInput): string {
  return hashCacheKeySyncMaterialized(input);
}

/**
 * Convert an authored cache key into JSON-safe debug data.
 *
 * Binary values are represented by type, byte length, and SHA-256 digest so
 * raw-key debug sidecars stay inspectable without embedding large byte arrays.
 */
export function serializeCacheKeyDebugValue(value: unknown): unknown {
  return serializeCacheKeyDebugValue_(value, new WeakSet());
}

function hashCacheKeySyncMaterialized(input: unknown): string {
  return createHash('sha256')
    .update(getCompositeKey(input, { stringify: stringifyCacheKeyValue }))
    .digest('hex');
}

function stringifyCacheKeyValue(value: unknown): string | undefined {
  if (value instanceof SerializedCacheKeyValue) {
    return value.value;
  }
  if (Buffer.isBuffer(value)) {
    return `$buffer:${hashBytes(value)}`;
  }
  if (isArrayBuffer(value)) {
    return `$arrayBuffer:${hashBytes(new Uint8Array(value))}`;
  }
  if (isSharedArrayBuffer(value)) {
    return `$sharedArrayBuffer:${hashBytes(new Uint8Array(value))}`;
  }
  if (isArrayBufferView(value)) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    return `$${value.constructor.name}:${hashBytes(bytes)}`;
  }
  if (isFile(value)) {
    return `$file:${getCompositeKey({
      lastModified: value.lastModified,
      name: value.name,
      size: value.size,
      type: value.type,
    })}`;
  }
  if (isBlob(value)) {
    return `$blob:${getCompositeKey({ size: value.size, type: value.type })}`;
  }
  return undefined;
}

function serializeCacheKeyDebugValue_(
  value: unknown,
  refs: WeakSet<object>,
): unknown {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') {
    return {
      __agentEvalsUnsupportedJsonValue: 'bigint',
      value: value.toString(),
    };
  }
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'symbol') {
    return {
      __agentEvalsUnsupportedJsonValue: 'symbol',
      value: value.description ?? null,
    };
  }
  if (typeof value === 'function') {
    return {
      __agentEvalsUnsupportedJsonValue: 'function',
      value: value.name.length > 0 ? value.name : null,
    };
  }
  if (Buffer.isBuffer(value)) {
    return cacheKeyDebugBinaryValue('Buffer', value);
  }
  if (isArrayBuffer(value)) {
    return cacheKeyDebugBinaryValue('ArrayBuffer', new Uint8Array(value));
  }
  if (isSharedArrayBuffer(value)) {
    return cacheKeyDebugBinaryValue('SharedArrayBuffer', new Uint8Array(value));
  }
  if (isArrayBufferView(value)) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    return cacheKeyDebugBinaryValue(value.constructor.name, bytes);
  }
  if (value instanceof Date) return value.toJSON();
  if (value instanceof URL) return value.toString();
  if (value instanceof URLSearchParams) return value.toString();
  if (isFile(value)) {
    return {
      __agentEvalsCacheKeyBlob: 'v1',
      lastModified: value.lastModified,
      name: value.name,
      size: value.size,
      type: value.type,
    } satisfies CacheKeyDebugBlobValue;
  }
  if (isBlob(value)) {
    return {
      __agentEvalsCacheKeyBlob: 'v1',
      size: value.size,
      type: value.type,
    } satisfies CacheKeyDebugBlobValue;
  }

  if (refs.has(value)) throw new Error('Circular reference detected');
  refs.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeCacheKeyDebugValue_(item, refs));
    refs.delete(value);
    return items;
  }

  const entries: [string, unknown][] = [];
  for (const [key, entryValue] of Object.entries(value)) {
    const serialized = serializeCacheKeyDebugValue_(entryValue, refs);
    if (serialized !== undefined) entries.push([key, serialized]);
  }
  refs.delete(value);
  return Object.fromEntries(entries);
}

function cacheKeyDebugBinaryValue(
  type: string,
  bytes: NodeJS.ArrayBufferView,
): CacheKeyDebugBinaryValue {
  return {
    __agentEvalsCacheKeyBinary: 'v1',
    byteLength: bytes.byteLength,
    sha256: `sha256:${hashBytes(bytes)}`,
    type,
  };
}

async function materializeAsyncCacheKeyValue(
  value: unknown,
  refs = new WeakSet<object>(),
): Promise<unknown> {
  const serialized = await stringifyAsyncCacheKeyValue(value);
  if (serialized !== undefined) {
    return new SerializedCacheKeyValue(serialized);
  }
  if (stringifyCacheKeyValue(value) !== undefined) return value;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      items.push(await materializeAsyncCacheKeyValue(item, refs));
    }
    return items;
  }

  if (refs.has(value)) throw new Error('Circular reference detected');
  refs.add(value);
  const entries: [string, unknown][] = [];
  for (const [key, entryValue] of Object.entries(value)) {
    entries.push([key, await materializeAsyncCacheKeyValue(entryValue, refs)]);
  }
  refs.delete(value);
  return Object.fromEntries(entries);
}

async function stringifyAsyncCacheKeyValue(
  value: unknown,
): Promise<string | undefined> {
  if (isFile(value)) {
    return `$file:${getCompositeKey({
      bytes: await hashBlobBytes(value),
      lastModified: value.lastModified,
      name: value.name,
      size: value.size,
      type: value.type,
    })}`;
  }
  if (isBlob(value)) {
    return `$blob:${getCompositeKey({
      bytes: await hashBlobBytes(value),
      size: value.size,
      type: value.type,
    })}`;
  }
  return undefined;
}

async function hashBlobBytes(value: Blob): Promise<string> {
  return hashBytes(new Uint8Array(await value.arrayBuffer()));
}

function hashBytes(value: NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(value).digest('hex');
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return value instanceof SharedArrayBuffer;
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function isBlob(value: unknown): value is Blob {
  return value instanceof Blob;
}

function isFile(value: unknown): value is File {
  return value instanceof File;
}
