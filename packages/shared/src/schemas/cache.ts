import { z } from 'zod/v4';
import {
  traceSpanErrorSchema,
  traceSpanKindSchema,
  traceSpanWarningSchema,
  type EvalTraceSpanError,
  type EvalTraceSpanWarning,
} from './trace.ts';

/**
 * Mode that controls how the cache is consulted for a given run.
 *
 * - `use`: read cache on hit, write on miss. Default.
 * - `bypass`: never read, never write.
 * - `refresh`: never read, always write (forces re-execution and overwrites).
 */
export const cacheModeSchema = z.enum(['use', 'bypass', 'refresh']);
/** Mode controlling how cached spans behave during a run. */
export type CacheMode = z.infer<typeof cacheModeSchema>;

/** Options accepted by an `evalTracer.span` call to opt the span into caching. */
export const spanCacheOptionsSchema = z.object({
  /** Arbitrary JSON-safe value used to derive the cache key. */
  key: z.unknown(),
  /** Required cache namespace shared by span cache entries in the same domain. */
  namespace: z.string().min(1),
  /**
   * Include native `Blob`/`File` bytes in the cache key. By default only stable
   * metadata (`type`, `size`, plus `name`/`lastModified` for `File`) is used.
   */
  serializeFileBytes: z.boolean().optional(),
});
/** Options accepted by an `evalTracer.span` call to opt the span into caching. */
export type SpanCacheOptions = z.infer<typeof spanCacheOptionsSchema>;

/** Category of operation stored in the eval cache. */
export const cacheOperationTypeSchema = z.enum(['span', 'value']);
/** Category of operation stored in the eval cache. */
export type CacheOperationType = z.infer<typeof cacheOperationTypeSchema>;

/** Status of a cache lookup recorded on a span or case scope. */
export const cacheStatusSchema = z.enum(['hit', 'miss', 'refresh', 'bypass']);
/** Status of a cache lookup recorded on a span or case scope. */
export type CacheStatus = z.infer<typeof cacheStatusSchema>;

/**
 * Reference to a value-cache lookup performed via `evalTracer.cache(...)`.
 *
 * Refs are appended to the active span's `cache.refs` attribute when the call
 * happens inside a `traceSpan(...)` body, or to the case scope's
 * `caseCacheRefs` bucket when the call is made directly from the case body.
 */
export const traceCacheRefSchema = z.object({
  type: z.literal('value'),
  name: z.string(),
  namespace: z.string(),
  key: z.string(),
  status: cacheStatusSchema,
  /** Whether this ref attempted to read from cache. Defaults to true. */
  read: z.boolean().optional(),
  /** Whether this ref wrote a persisted cache entry. Defaults to true for misses/refreshes. */
  stored: z.boolean().optional(),
  storedAt: z.string().optional(),
  age: z.number().optional(),
});
/** Reference to a value-cache lookup performed via `evalTracer.cache(...)`. */
export type TraceCacheRef = z.infer<typeof traceCacheRefSchema>;

/** Summary of a single persisted cache entry, used by list/delete endpoints. */
export const cacheListItemSchema = z.object({
  key: z.string(),
  namespace: z.string(),
  operationType: cacheOperationTypeSchema,
  operationName: z.string(),
  spanName: z.string().optional(),
  spanKind: traceSpanKindSchema.optional(),
  storedAt: z.string(),
  sizeBytes: z.number(),
});
/** Summary row for a single cache entry. */
export type CacheListItem = z.infer<typeof cacheListItemSchema>;

/** Serialized nested span captured while recording a cached operation. */
export type SerializedCacheSpan = {
  kind: string;
  name: string;
  attributes?: Record<string, unknown>;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  error?: EvalTraceSpanError;
  errors?: EvalTraceSpanError[];
  warning?: EvalTraceSpanWarning;
  warnings?: EvalTraceSpanWarning[];
  children: SerializedCacheSpan[];
};

const serializedCacheSpanBase = z.object({
  kind: traceSpanKindSchema,
  name: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['running', 'ok', 'error', 'cancelled']),
  error: traceSpanErrorSchema.optional(),
  errors: z.array(traceSpanErrorSchema).optional(),
  warning: traceSpanWarningSchema.optional(),
  warnings: z.array(traceSpanWarningSchema).optional(),
});

/** Zod schema for `SerializedCacheSpan`, defined lazily for recursion. */
export const serializedCacheSpanSchema: z.ZodType<SerializedCacheSpan> =
  serializedCacheSpanBase.extend({
    children: z.lazy(() => z.array(serializedCacheSpanSchema)),
  });

/**
 * One captured operation performed while a cached span's body executed.
 *
 * Operations are replayed in order against a fresh scope on cache hit to
 * reproduce the observable effects of the original run.
 */
export const cacheRecordingOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('setOutput'),
    key: z.string(),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal('appendOutput'),
    key: z.string(),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal('mergeOutput'),
    key: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('incrementOutput'),
    key: z.string(),
    delta: z.number(),
  }),
  z.object({
    kind: z.literal('checkpoint'),
    name: z.string(),
    data: z.unknown(),
  }),
  z.object({ kind: z.literal('subSpan'), span: serializedCacheSpanSchema }),
]);
/** Single effect captured by a cache recording. */
export type CacheRecordingOp = z.infer<typeof cacheRecordingOpSchema>;

/** Captured observable effects + return value of a cached span body. */
export const cacheRecordingSchema = z.object({
  returnValue: z.unknown(),
  finalAttributes: z.record(z.string(), z.unknown()),
  finalStatus: z.enum(['running', 'ok', 'error', 'cancelled']).optional(),
  finalError: traceSpanErrorSchema.optional(),
  finalErrors: z.array(traceSpanErrorSchema).optional(),
  finalWarning: traceSpanWarningSchema.optional(),
  finalWarnings: z.array(traceSpanWarningSchema).optional(),
  ops: z.array(cacheRecordingOpSchema),
});
/** Captured observable effects + return value of a cached span body. */
export type CacheRecording = z.infer<typeof cacheRecordingSchema>;

/** Persisted cache file containing metadata and a recording. */
export const cacheEntrySchema = z.object({
  version: z.literal(1),
  key: z.string(),
  namespace: z.string(),
  operationType: cacheOperationTypeSchema.optional(),
  operationName: z.string().optional(),
  spanName: z.string().optional(),
  spanKind: traceSpanKindSchema.optional(),
  storedAt: z.string(),
  recording: cacheRecordingSchema,
});
/** Persisted cache file contents. */
export type CacheEntry = z.infer<typeof cacheEntrySchema>;

/** Debug-only raw key metadata stored outside the reusable cache entry. */
export const cacheDebugKeyEntrySchema = z.object({
  version: z.literal(1),
  key: z.string(),
  namespace: z.string(),
  operationType: cacheOperationTypeSchema,
  operationName: z.string(),
  storedAt: z.string(),
  rawKey: z.unknown(),
});
/** Debug-only raw cache key entry. May contain sensitive prompt/input data. */
export type CacheDebugKeyEntry = z.infer<typeof cacheDebugKeyEntrySchema>;

/** Cache lookup response with optional debug-only raw key data. */
export const cacheEntryWithDebugKeySchema = cacheEntrySchema.extend({
  debugKey: cacheDebugKeyEntrySchema.optional(),
});
/** Cache lookup response returned by cache APIs when raw-key debug data exists. */
export type CacheEntryWithDebugKey = z.infer<
  typeof cacheEntryWithDebugKeySchema
>;

/** Persisted per-owner cache file containing multiple cache entries. */
export const cacheFileSchema = z.object({
  version: z.literal(1),
  owner: z.string(),
  entries: z.record(z.string(), cacheEntrySchema),
});
/** Persisted per-owner cache file contents. */
export type CacheFile = z.infer<typeof cacheFileSchema>;

/** Persisted per-owner debug file containing raw cache key metadata. */
export const cacheDebugKeyFileSchema = z.object({
  version: z.literal(1),
  owner: z.string(),
  entries: z.record(z.string(), cacheDebugKeyEntrySchema),
});
/** Persisted per-owner raw cache key debug file contents. */
export type CacheDebugKeyFile = z.infer<typeof cacheDebugKeyFileSchema>;
