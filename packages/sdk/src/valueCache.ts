import type { CacheRecording, CacheStorage } from '@agent-evals/shared';
import { hashCacheKey } from './cacheKey.ts';
import {
  appendSubSpanOps,
  recordCacheRef,
  replayRecording,
} from './cacheRecording.ts';
import {
  deserializeCacheRecording,
  serializeCacheRecording,
} from './cacheSerialization.ts';
import type { CacheAdapter, CacheRecordingFrame } from './runtime.ts';
import {
  getCurrentActiveSpan,
  getCurrentScope,
  getRealDateNowMs,
  getCacheAdapterForStorage,
  runWithCacheRecordingFrame,
} from './runtime.ts';

/** Info accepted by `evalTracer.cache(info, fn)` for spanless value caching. */
export type TraceCacheInfo = {
  /** Display name used for cache listings and the default namespace. */
  name: string;
  /** Arbitrary JSON-safe value used to derive the cache key. */
  key: unknown;
  /** Override the default namespace (`${evalId}.${name}`). */
  namespace?: string;
  /**
   * Cache storage target. Durable entries use `.agent-evals/cache`; temporary
   * entries use `.agent-evals/tmp/cache` and are intended to stay uncommitted.
   */
  storage?: CacheStorage;
  /**
   * Include native `Blob`/`File` bytes in the cache key. By default only stable
   * metadata (`type`, `size`, plus `name`/`lastModified` for `File`) is used.
   */
  serializeFileBytes?: boolean;
};

/** Info accepted by `evalTracer.cache.get(...)` and `evalTracer.cache.set(...)`. */
export type TraceCacheManualInfo = {
  /** Required cache namespace shared by related manual value entries. */
  namespace: string;
  /** Arbitrary JSON-safe value used to derive the cache key. */
  key: unknown;
  /** Display name used for cache refs. Defaults to `namespace`. */
  name?: string;
  /**
   * Cache storage target. Durable entries use `.agent-evals/cache`; temporary
   * entries use `.agent-evals/tmp/cache` and are intended to stay uncommitted.
   */
  storage?: CacheStorage;
  /**
   * Include native `Blob`/`File` bytes in the cache key. By default only stable
   * metadata (`type`, `size`, plus `name`/`lastModified` for `File`) is used.
   */
  serializeFileBytes?: boolean;
};

/** Info accepted by the single-argument `evalTracer.cache.set(...)` form. */
export type TraceCacheSetInfo<T> = TraceCacheManualInfo & {
  /** Value to persist for later `evalTracer.cache.get(...)` calls. */
  value: T;
};

/** Result returned by `evalTracer.cache.get(...)`. */
export type TraceCacheGetResult<T> =
  | { hit: true; value: T }
  | { hit: false };

/** Callable cache helper plus explicit get/set primitives. */
export type TraceCache = {
  /** Cache a pure value and replay SDK-mediated effects on cache hits. */
  <T>(info: TraceCacheInfo, fn: () => Promise<T> | T): Promise<T>;
  /** Cache a pure value and replay SDK-mediated effects on cache hits. */
  (info: TraceCacheInfo, fn: () => unknown): Promise<unknown>;
  /**
   * Read a cached value without running a callback or replaying cached SDK
   * effects. Misses include disabled-read and refresh/bypass modes.
   */
  get<T = unknown>(
    info: TraceCacheManualInfo,
  ): Promise<TraceCacheGetResult<T>>;
  /**
   * Persist a manual cached value. This is a no-op when cache writes are
   * disabled by run/eval cache settings.
   */
  set<T>(info: TraceCacheSetInfo<T>): Promise<void>;
  /**
   * Persist a manual cached value. This is a no-op when cache writes are
   * disabled by run/eval cache settings.
   */
  set<T>(info: TraceCacheManualInfo, value: T): Promise<void>;
  /**
   * Convenience wrapper over `get` then `set` for simple pure values. Use raw
   * `get`/`set` when errors or partial-cache semantics should stay explicit.
   */
  getOrSet<T>(
    info: TraceCacheManualInfo,
    fn: () => Promise<T> | T,
  ): Promise<T>;
};

export type { TraceCacheRef } from './cacheRecording.ts';

type ResolvedCacheInfo = {
  name: string;
  namespace: string;
  key: unknown;
  storage: CacheStorage | undefined;
  serializeFileBytes: boolean;
};

type CacheLookupConfig = {
  scope: NonNullable<ReturnType<typeof getCurrentScope>>;
  cacheAdapter: CacheAdapter;
  activeSpan: ReturnType<typeof getCurrentActiveSpan>;
  canRead: boolean;
  canStore: boolean;
  keyHash: string;
};

function resolveCallbackCacheInfo(
  info: TraceCacheInfo,
  evalId: string,
): ResolvedCacheInfo {
  return {
    name: info.name,
    namespace: info.namespace ?? `${evalId}.${info.name}`,
    key: info.key,
    storage: info.storage,
    serializeFileBytes: info.serializeFileBytes === true,
  };
}

function resolveManualCacheInfo(info: TraceCacheManualInfo): ResolvedCacheInfo {
  return {
    name: info.name ?? info.namespace,
    namespace: info.namespace,
    key: info.key,
    storage: info.storage,
    serializeFileBytes: info.serializeFileBytes === true,
  };
}

async function prepareCacheLookup(
  info: ResolvedCacheInfo,
): Promise<CacheLookupConfig | undefined> {
  const scope = getCurrentScope();
  if (!scope) return undefined;

  const cacheCtx = scope.cacheContext;
  if (cacheCtx === undefined || scope.replayingDepth > 0) {
    return undefined;
  }

  const cacheAdapter = getCacheAdapterForStorage(cacheCtx, info.storage);
  const keyHash = await hashCacheKey(
    { namespace: info.namespace, key: info.key },
    { serializeFileBytes: info.serializeFileBytes },
  );

  return {
    scope,
    cacheAdapter,
    activeSpan: getCurrentActiveSpan(),
    canRead: cacheCtx.mode === 'use' && cacheCtx.read !== false,
    canStore: cacheCtx.mode !== 'bypass' && cacheCtx.store !== false,
    keyHash,
  };
}

function cacheStorageRef(info: ResolvedCacheInfo): { storage?: 'temporary' } {
  return info.storage === 'temporary' ? { storage: 'temporary' } : {};
}

async function recordManualCacheGet(
  info: ResolvedCacheInfo,
): Promise<TraceCacheGetResult<unknown>> {
  const lookupConfig = await prepareCacheLookup(info);
  if (lookupConfig === undefined) return { hit: false };

  const { scope, cacheAdapter, activeSpan, canRead, canStore, keyHash } =
    lookupConfig;

  if (canRead) {
    const hit = await cacheAdapter.lookup(info.namespace, keyHash);
    if (hit) {
      const storedAt = hit.storedAt;
      const age = getRealDateNowMs() - new Date(storedAt).getTime();
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: info.name,
        namespace: info.namespace,
        key: keyHash,
        status: 'hit',
        ...cacheStorageRef(info),
        storedAt,
        age,
      });
      const recording = deserializeCacheRecording(hit.recording);
      return { hit: true, value: recording.returnValue };
    }
    recordCacheRef(scope, activeSpan, {
      type: 'value',
      name: info.name,
      namespace: info.namespace,
      key: keyHash,
      status: 'miss',
      ...cacheStorageRef(info),
      ...(canStore ? {} : { stored: false }),
    });
    return { hit: false };
  }

  const cacheCtx = scope.cacheContext;
  if (cacheCtx?.mode === 'use' && canStore) {
    recordCacheRef(scope, activeSpan, {
      type: 'value',
      name: info.name,
      namespace: info.namespace,
      key: keyHash,
      status: 'miss',
      ...cacheStorageRef(info),
      read: false,
    });
  } else if (cacheCtx?.mode === 'refresh') {
    recordCacheRef(scope, activeSpan, {
      type: 'value',
      name: info.name,
      namespace: info.namespace,
      key: keyHash,
      status: 'refresh',
      ...cacheStorageRef(info),
      ...(canStore ? {} : { stored: false }),
    });
  } else {
    recordCacheRef(scope, activeSpan, {
      type: 'value',
      name: info.name,
      namespace: info.namespace,
      key: keyHash,
      status: 'bypass',
      ...cacheStorageRef(info),
    });
  }

  return { hit: false };
}

async function writeManualCacheValue(
  info: ResolvedCacheInfo,
  value: unknown,
): Promise<void> {
  const lookupConfig = await prepareCacheLookup(info);
  if (lookupConfig?.canStore !== true) return;

  const recording: CacheRecording = {
    returnValue: value,
    finalAttributes: {},
    ops: [],
  };
  await lookupConfig.cacheAdapter.write(
    {
      version: 1,
      key: lookupConfig.keyHash,
      namespace: info.namespace,
      operationType: 'value',
      operationName: info.name,
      storedAt: new Date(getRealDateNowMs()).toISOString(),
      recording: await serializeCacheRecording(recording, {
        externalJsonStore: lookupConfig.cacheAdapter.externalJsonStore,
      }),
    },
    { rawKey: info.key, operationType: 'value', operationName: info.name },
  );
}

export function createTraceCache(generateSpanId: () => string): TraceCache {
  async function traceCache<T>(
    info: TraceCacheInfo,
    fn: () => Promise<T> | T,
  ): Promise<T>;
  async function traceCache(
    info: TraceCacheInfo,
    fn: () => unknown,
  ): Promise<unknown>;
  async function traceCache(
    info: TraceCacheInfo,
    fn: () => unknown,
  ): Promise<unknown> {
    const scope = getCurrentScope();
    if (!scope) return await fn();

    const cacheCtx = scope.cacheContext;
    if (cacheCtx === undefined || scope.replayingDepth > 0) {
      return await fn();
    }

    const resolvedInfo = resolveCallbackCacheInfo(info, cacheCtx.evalId);
    const lookupConfig = await prepareCacheLookup(resolvedInfo);
    if (lookupConfig === undefined) return await fn();

    const { cacheAdapter, activeSpan, canRead, canStore, keyHash } =
      lookupConfig;

    if (canRead) {
      const hit = await cacheAdapter.lookup(resolvedInfo.namespace, keyHash);
      if (hit) {
        const storedAt = hit.storedAt;
        const age = getRealDateNowMs() - new Date(storedAt).getTime();
        recordCacheRef(scope, activeSpan, {
          type: 'value',
          name: resolvedInfo.name,
          namespace: resolvedInfo.namespace,
          key: keyHash,
          status: 'hit',
          ...cacheStorageRef(resolvedInfo),
          storedAt,
          age,
        });
        const recording = deserializeCacheRecording(hit.recording);
        replayRecording(scope, activeSpan, recording, { generateSpanId });
        return recording.returnValue;
      }
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: resolvedInfo.name,
        namespace: resolvedInfo.namespace,
        key: keyHash,
        status: 'miss',
        ...cacheStorageRef(resolvedInfo),
        ...(canStore ? {} : { stored: false }),
      });
    } else if (cacheCtx.mode === 'use' && canStore) {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: resolvedInfo.name,
        namespace: resolvedInfo.namespace,
        key: keyHash,
        status: 'miss',
        ...cacheStorageRef(resolvedInfo),
        read: false,
      });
    } else if (cacheCtx.mode === 'refresh') {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: resolvedInfo.name,
        namespace: resolvedInfo.namespace,
        key: keyHash,
        status: 'refresh',
        ...cacheStorageRef(resolvedInfo),
        ...(canStore ? {} : { stored: false }),
      });
    } else {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: resolvedInfo.name,
        namespace: resolvedInfo.namespace,
        key: keyHash,
        status: 'bypass',
        ...cacheStorageRef(resolvedInfo),
      });
    }

    const frame: CacheRecordingFrame = {
      baseSpanIndex: scope.spans.length,
      replayParentSpanId: activeSpan?.id ?? null,
      spanIds: new Set<string>(),
      finalAttributes: {},
      ops: [],
    };

    const bodyResult = await runWithCacheRecordingFrame(frame, async () => {
      return await fn();
    });

    appendSubSpanOps(scope, frame);

    if (canStore) {
      const recording: CacheRecording = {
        returnValue: bodyResult,
        finalAttributes: frame.finalAttributes,
        ops: frame.ops,
      };
      await cacheAdapter.write(
        {
          version: 1,
          key: keyHash,
          namespace: resolvedInfo.namespace,
          operationType: 'value',
          operationName: resolvedInfo.name,
          storedAt: new Date(getRealDateNowMs()).toISOString(),
          recording: await serializeCacheRecording(recording, {
            externalJsonStore: cacheAdapter.externalJsonStore,
          }),
        },
        {
          rawKey: resolvedInfo.key,
          operationType: 'value',
          operationName: resolvedInfo.name,
        },
      );
    }

    return bodyResult;
  }

  async function traceCacheGet<T>(
    info: TraceCacheManualInfo,
  ): Promise<TraceCacheGetResult<T>>;
  async function traceCacheGet(
    info: TraceCacheManualInfo,
  ): Promise<TraceCacheGetResult<unknown>> {
    return await recordManualCacheGet(resolveManualCacheInfo(info));
  }

  async function traceCacheSet<T>(info: TraceCacheSetInfo<T>): Promise<void>;
  async function traceCacheSet<T>(
    info: TraceCacheManualInfo,
    value: T,
  ): Promise<void>;
  async function traceCacheSet<T>(
    info: TraceCacheManualInfo | TraceCacheSetInfo<T>,
    value?: T,
  ): Promise<void> {
    const valueToStore = arguments.length === 1 && 'value' in info
      ? info.value
      : value;
    await writeManualCacheValue(resolveManualCacheInfo(info), valueToStore);
  }

  async function traceCacheGetOrSet<T>(
    info: TraceCacheManualInfo,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const entry = await traceCacheGet<T>(info);
    if (entry.hit) return entry.value;
    const value = await fn();
    await traceCacheSet(info, value);
    return value;
  }

  return Object.assign(traceCache, {
    get: traceCacheGet,
    set: traceCacheSet,
    getOrSet: traceCacheGetOrSet,
  });
}
