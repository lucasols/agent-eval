import type { CacheRecording } from '@agent-evals/shared';
import { hashCacheKey } from './cacheKey.ts';
import {
  appendSubSpanOps,
  diffNonCacheAttributes,
  recordCacheRef,
  replayRecording,
  snapshotNonCacheAttributes,
} from './cacheRecording.ts';
import {
  deserializeCacheRecording,
  serializeCacheRecording,
} from './cacheSerialization.ts';
import type { CacheRecordingFrame } from './runtime.ts';
import { getCurrentScope, getRealDateNowMs } from './runtime.ts';

/** Info accepted by `evalTracer.cache(info, fn)` for spanless value caching. */
export type TraceCacheInfo = {
  /** Display name used for cache listings and the default namespace. */
  name: string;
  /** Arbitrary JSON-safe value used to derive the cache key. */
  key: unknown;
  /** Override the default namespace (`${evalId}__${name}`). */
  namespace?: string;
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

    const namespace = info.namespace ?? `${cacheCtx.evalId}__${info.name}`;
    const keyHash = await hashCacheKey(
      { namespace, key: info.key },
      { serializeFileBytes: info.serializeFileBytes === true },
    );
    const activeSpan = scope.activeSpanStack.at(-1);

    if (cacheCtx.mode === 'use') {
      const hit = await cacheCtx.adapter.lookup(namespace, keyHash);
      if (hit) {
        const storedAt = hit.storedAt;
        const age = Date.now() - new Date(storedAt).getTime();
        recordCacheRef(scope, activeSpan, {
          type: 'value',
          name: info.name,
          namespace,
          key: keyHash,
          status: 'hit',
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
      });
    } else if (cacheCtx.mode === 'refresh') {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: info.name,
        namespace,
        key: keyHash,
        status: 'refresh',
      });
    } else {
      recordCacheRef(scope, activeSpan, {
        type: 'value',
        name: info.name,
        namespace,
        key: keyHash,
        status: 'bypass',
      });
    }

    const beforeAttributes = await snapshotNonCacheAttributes(activeSpan);
    const frame: CacheRecordingFrame = {
      baseSpanIndex: scope.spans.length,
      replayParentSpanId: activeSpan?.id ?? null,
      ops: [],
    };
    scope.recordingStack.push(frame);

    let bodyResult: unknown;
    try {
      bodyResult = await fn();
    } finally {
      scope.recordingStack.pop();
    }

    appendSubSpanOps(scope, frame);

    if (cacheCtx.mode !== 'bypass') {
      const finalAttributes = diffNonCacheAttributes(
        beforeAttributes,
        await snapshotNonCacheAttributes(activeSpan),
      );
      const recording: CacheRecording = {
        returnValue: bodyResult,
        finalAttributes,
        ops: frame.ops,
      };
      await cacheCtx.adapter.write(
        {
          version: 1,
          key: keyHash,
          namespace,
          operationType: 'value',
          operationName: info.name,
          storedAt: new Date(getRealDateNowMs()).toISOString(),
          recording: await serializeCacheRecording(recording),
        },
        { rawKey: info.key, operationType: 'value', operationName: info.name },
      );
    }

    return bodyResult;
  };
}
