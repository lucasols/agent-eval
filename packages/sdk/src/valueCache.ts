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
import type { CacheRecordingFrame } from './runtime.ts';
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

export type { TraceCacheRef } from './cacheRecording.ts';

export function createTraceCache(generateSpanId: () => string): {
  <T>(info: TraceCacheInfo, fn: () => Promise<T> | T): Promise<T>;
  (info: TraceCacheInfo, fn: () => unknown): Promise<unknown>;
} {
  return async function traceCache(
    info: TraceCacheInfo,
    fn: () => unknown,
  ): Promise<unknown> {
    const scope = getCurrentScope();
    if (!scope) return await fn();

    const cacheCtx = scope.cacheContext;
    if (cacheCtx === undefined || scope.replayingDepth > 0) {
      return await fn();
    }

    const namespace = info.namespace ?? `${cacheCtx.evalId}.${info.name}`;
    const cacheAdapter = getCacheAdapterForStorage(cacheCtx, info.storage);
    const keyHash = await hashCacheKey(
      { namespace, key: info.key },
      { serializeFileBytes: info.serializeFileBytes === true },
    );
    const activeSpan = getCurrentActiveSpan();
    const canRead = cacheCtx.mode === 'use' && cacheCtx.read !== false;
    const canStore = cacheCtx.mode !== 'bypass' && cacheCtx.store !== false;

    if (canRead) {
      const hit = await cacheAdapter.lookup(namespace, keyHash);
      if (hit) {
        const storedAt = hit.storedAt;
        const age = getRealDateNowMs() - new Date(storedAt).getTime();
        recordCacheRef(scope, activeSpan, {
          type: 'value',
          name: info.name,
          namespace,
          key: keyHash,
          status: 'hit',
          ...(info.storage === 'temporary' ? { storage: 'temporary' } : {}),
          storedAt,
          age,
        });
        const recording = deserializeCacheRecording(hit.recording);
        replayRecording(scope, activeSpan, recording, { generateSpanId });
        return recording.returnValue;
      }
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: info.name,
        namespace,
        key: keyHash,
        status: 'miss',
        ...(info.storage === 'temporary' ? { storage: 'temporary' } : {}),
        ...(canStore ? {} : { stored: false }),
      });
    } else if (cacheCtx.mode === 'use' && canStore) {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: info.name,
        namespace,
        key: keyHash,
        status: 'miss',
        ...(info.storage === 'temporary' ? { storage: 'temporary' } : {}),
        read: false,
      });
    } else if (cacheCtx.mode === 'refresh') {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: info.name,
        namespace,
        key: keyHash,
        status: 'refresh',
        ...(info.storage === 'temporary' ? { storage: 'temporary' } : {}),
        ...(canStore ? {} : { stored: false }),
      });
    } else {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: info.name,
        namespace,
        key: keyHash,
        status: 'bypass',
        ...(info.storage === 'temporary' ? { storage: 'temporary' } : {}),
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
          namespace,
          operationType: 'value',
          operationName: info.name,
          storedAt: new Date(getRealDateNowMs()).toISOString(),
          recording: await serializeCacheRecording(recording, {
            externalJsonStore: cacheAdapter.externalJsonStore,
          }),
        },
        { rawKey: info.key, operationType: 'value', operationName: info.name },
      );
    }

    return bodyResult;
  };
}
