import type {
  CacheEntry,
  CacheRecording,
  EvalTraceSpan,
  SpanCacheOptions,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { hashCacheKey } from './cacheKey.ts';
import { appendSubSpanOps, replayRecording } from './cacheRecording.ts';
import {
  deserializeCacheRecording,
  serializeCacheRecording,
} from './cacheSerialization.ts';
import type { CacheRecordingFrame, EvalCaseScope } from './runtime.ts';
import {
  getCurrentActiveSpan,
  getCurrentScope,
  getRealDateNowMs,
  getCacheAdapterForStorage,
  recordCacheRecordingAttributesIfActive,
  recordCacheRecordingOpIfActive,
  recordSpanForActiveCacheRecording,
  runWithCacheRecordingFrame,
  runWithActiveSpan,
  startEvalBackgroundJob,
} from './runtime.ts';
import {
  appendSpanErrors,
  appendSpanWarnings,
  hasSpanError,
  normalizeTraceError,
  normalizeTraceErrors,
  normalizeTraceWarnings,
  splitCaptureEvalSpanErrorArgs,
} from './traceDiagnostics.ts';
import type { EvalTraceTree } from './types.ts';
import { createTraceCache } from './valueCache.ts';

export type {
  CaptureEvalSpanErrorLevel,
  CaptureEvalSpanErrorOptions,
} from './traceDiagnostics.ts';
export type {
  TraceCache,
  TraceCacheGetResult,
  TraceCacheInfo,
  TraceCacheManualInfo,
  TraceCacheRef,
  TraceCacheSetInfo,
} from './valueCache.ts';
export {
  hashCacheKey,
  hashCacheKeySync,
  type CacheKeyHashInput,
  type CacheKeyHashOptions,
} from './cacheKey.ts';
/** Mutable handle for the current span. Prefer ambient `evalSpan` in helpers. */
export type TraceActiveSpan = {
  /** Rename the active span after it has been created. */
  setName(value: string): void;
  /** Set a single attribute on the active span. Later writes replace the same key. */
  setAttribute(key: string, value: unknown): void;
  /** Merge multiple attributes into the active span. */
  setAttributes(value: Record<string, unknown>): void;
  /** Add a numeric delta to one attribute. */
  incrementAttribute(key: string, delta: number): void;
  /** Append one item to an attribute array, preserving an existing scalar. */
  appendToAttribute(key: string, value: unknown): void;
  /** Shallow-merge object fields into one attribute. */
  mergeAttribute(key: string, patch: Record<string, unknown>): void;
};

/** Timestamp accepted by the external span lifecycle API. */
export type TraceSpanTimestamp = Date | string;

/** Info accepted by `evalTracer.startSpan(info)` for externally managed spans. */
export type TraceExternalSpanStartInfo = {
  /** Stable span id from the upstream tracer. Generated when omitted. */
  id?: string;
  /** Parent span id from the upstream tracer. Defaults to the active eval span. */
  parentId?: string | null;
  /** Semantic category used by the trace UI. */
  kind: string;
  /** Display name for the span. */
  name: string;
  /** Span start time. Defaults to now. */
  startedAt?: TraceSpanTimestamp;
  /** Initial span attributes. Later updates merge into this object. */
  attributes?: Record<string, unknown>;
};

/** Info accepted by `evalTracer.updateSpan(info)` for lifecycle updates. */
export type TraceExternalSpanUpdateInfo = {
  /** Span id previously passed to `evalTracer.startSpan(...)`. */
  id: string;
  /** Optional replacement display name. */
  name?: string;
  /** Attributes to merge into the recorded span. */
  attributes?: Record<string, unknown>;
  /** Optional status override, useful when the upstream tracer emits one. */
  status?: EvalTraceSpan['status'];
  /** Optional error payload to attach to the span. */
  error?: EvalTraceSpan['error'];
  /** Optional latest warning payload to attach to the span. */
  warning?: EvalTraceSpan['warning'];
  /** Optional warning payloads to attach to the span. */
  warnings?: EvalTraceSpan['warnings'];
};

/** Info accepted by `evalTracer.endSpan(info)` for externally managed spans. */
export type TraceExternalSpanEndInfo = TraceExternalSpanUpdateInfo & {
  /** Span end time. Defaults to now. */
  endedAt?: TraceSpanTimestamp;
};

/** Info accepted by `evalTracer.recordSpan(info)` for completed external spans. */
export type TraceExternalSpanRecordInfo = {
  /** Stable span id from the upstream tracer. Generated when omitted. */
  id?: string;
  /** Parent span id from the upstream tracer. Defaults to the active eval span. */
  parentId?: string | null;
  /** Semantic category used by the trace UI. */
  kind: string;
  /** Display name for the span. */
  name: string;
  /** Span start time. Defaults to now. */
  startedAt?: TraceSpanTimestamp;
  /** Span end time. Defaults to the start time. */
  endedAt?: TraceSpanTimestamp | null;
  /** Final span status. Defaults to `ok`. */
  status?: EvalTraceSpan['status'];
  /** Final span attributes. */
  attributes?: Record<string, unknown>;
  /** Optional error payload to attach to the span. */
  error?: EvalTraceSpan['error'];
  /** Optional latest warning payload to attach to the span. */
  warning?: EvalTraceSpan['warning'];
  /** Optional warning payloads to attach to the span. */
  warnings?: EvalTraceSpan['warnings'];
};

/** Mutable handle returned by `evalTracer.startSpan(...)`. */
export type TraceExternalSpanHandle = TraceActiveSpan & {
  /** Recorded span id, either caller-provided or generated by the SDK. */
  id: string;
  /** Finish the external span and merge any final fields. */
  end(info?: Omit<TraceExternalSpanEndInfo, 'id'>): void;
};

let spanIdCounter = 0;

function generateSpanId(): string {
  spanIdCounter++;
  return `span_${String(Date.now())}_${String(spanIdCounter)}`;
}

function updateCurrentSpan(update: (currentSpan: EvalTraceSpan) => void): void {
  const currentSpan = getCurrentActiveSpan();
  if (!currentSpan) return;
  update(currentSpan);
}

function noopActiveSpan(): TraceActiveSpan {
  return {
    setName() {},
    setAttribute() {},
    setAttributes() {},
    incrementAttribute() {},
    appendToAttribute() {},
    mergeAttribute() {},
  };
}

function noopExternalSpan(id: string): TraceExternalSpanHandle {
  return {
    id,
    setName() {},
    setAttribute() {},
    setAttributes() {},
    incrementAttribute() {},
    appendToAttribute() {},
    mergeAttribute() {},
    end() {},
  };
}

function mergeSpanAttributes(
  span: EvalTraceSpan,
  attributes: Record<string, unknown>,
): void {
  span.attributes = { ...span.attributes, ...attributes };
  const scope = getCurrentScope();
  if (scope !== undefined) {
    recordCacheRecordingAttributesIfActive(scope, span, attributes);
  }
}

function copyNonCacheAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (!key.startsWith('cache.')) {
      result[key] = value;
    }
  }
  return result;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueKind(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value;
}

function recordSpanAttributeAssertion(message: string): void {
  const scope = getCurrentScope();
  if (!scope) return;
  scope.assertionFailures.push({ message });
  scope.assertions.push({ message, status: 'fail' });
}

function incrementSpanAttribute(
  span: EvalTraceSpan,
  key: string,
  delta: number,
): void {
  const existing = span.attributes?.[key];
  if (existing === undefined) {
    mergeSpanAttributes(span, { [key]: delta });
    return;
  }
  if (typeof existing !== 'number') {
    recordSpanAttributeAssertion(
      `evalSpan.incrementAttribute("${key}"): existing value is ${valueKind(existing)}, expected number`,
    );
    return;
  }
  mergeSpanAttributes(span, { [key]: existing + delta });
}

function appendToSpanAttribute(
  span: EvalTraceSpan,
  key: string,
  value: unknown,
): void {
  const existing = span.attributes?.[key];
  if (existing === undefined) {
    mergeSpanAttributes(span, { [key]: [value] });
    return;
  }
  if (Array.isArray(existing)) {
    const items: unknown[] = existing.map((item: unknown) => item);
    mergeSpanAttributes(span, { [key]: [...items, value] });
    return;
  }
  mergeSpanAttributes(span, { [key]: [existing, value] });
}

function mergeSpanAttribute(
  span: EvalTraceSpan,
  key: string,
  patch: Record<string, unknown>,
): void {
  const existing = span.attributes?.[key];
  if (existing === undefined) {
    mergeSpanAttributes(span, { [key]: { ...patch } });
    return;
  }
  if (!isRecordLike(existing)) {
    recordSpanAttributeAssertion(
      `evalSpan.mergeAttribute("${key}"): existing value is ${valueKind(existing)}, expected object`,
    );
    return;
  }
  mergeSpanAttributes(span, { [key]: { ...existing, ...patch } });
}

function addElapsedMsToTimestamp(
  isoTimestamp: string,
  elapsedMs: number,
): string {
  return new Date(new Date(isoTimestamp).getTime() + elapsedMs).toISOString();
}

function finishSpanWithoutThrownError(
  span: EvalTraceSpan,
  realStartedAt: number,
): void {
  span.status = hasSpanError(span) ? 'error' : 'ok';
  span.endedAt = addElapsedMsToTimestamp(
    span.startedAt,
    getRealDateNowMs() - realStartedAt,
  );
}

function createSpanHandle(span: EvalTraceSpan): TraceActiveSpan {
  return {
    setName(value) {
      span.name = value;
    },
    setAttribute(key, value) {
      mergeSpanAttributes(span, { [key]: value });
    },
    setAttributes(value) {
      mergeSpanAttributes(span, value);
    },
    incrementAttribute(key, delta) {
      incrementSpanAttribute(span, key, delta);
    },
    appendToAttribute(key, value) {
      appendToSpanAttribute(span, key, value);
    },
    mergeAttribute(key, patch) {
      mergeSpanAttribute(span, key, patch);
    },
  };
}

function updateExternalSpanRecord(
  id: string,
  update: (span: EvalTraceSpan) => void,
): void {
  const scope = getCurrentScope();
  if (!scope) return;
  const span = findSpan(scope, id);
  if (!span) return;
  update(span);
}

function createExternalSpanHandle(id: string): TraceExternalSpanHandle {
  return {
    id,
    setName(value) {
      updateExternalSpan({ id, name: value });
    },
    setAttribute(key, value) {
      updateExternalSpan({ id, attributes: { [key]: value } });
    },
    setAttributes(value) {
      updateExternalSpan({ id, attributes: value });
    },
    incrementAttribute(key, delta) {
      updateExternalSpanRecord(id, (span) => {
        incrementSpanAttribute(span, key, delta);
      });
    },
    appendToAttribute(key, value) {
      updateExternalSpanRecord(id, (span) => {
        appendToSpanAttribute(span, key, value);
      });
    },
    mergeAttribute(key, patch) {
      updateExternalSpanRecord(id, (span) => {
        mergeSpanAttribute(span, key, patch);
      });
    },
    end(info = {}) {
      endExternalSpan({ ...info, id });
    },
  };
}

function toIsoTimestamp(value: TraceSpanTimestamp | undefined): string {
  if (value === undefined) return new Date().toISOString();
  if (typeof value === 'string') return value;
  return value.toISOString();
}

function findSpan(scope: EvalCaseScope, id: string): EvalTraceSpan | undefined {
  return scope.spans.find((span) => span.id === id);
}

function resolveExternalParentId(
  parentId: string | null | undefined,
): string | null {
  if (parentId !== undefined) return parentId;
  return getCurrentActiveSpan()?.id ?? null;
}

function startExternalSpan(
  info: TraceExternalSpanStartInfo,
): TraceExternalSpanHandle {
  const id = info.id ?? generateSpanId();
  const scope = getCurrentScope();
  if (!scope) return noopExternalSpan(id);

  const existing = findSpan(scope, id);
  if (existing) {
    existing.parentId = resolveExternalParentId(info.parentId);
    existing.kind = info.kind;
    existing.name = info.name;
    existing.startedAt = toIsoTimestamp(info.startedAt);
    existing.status = 'running';
    existing.endedAt = null;
    if (info.attributes !== undefined) {
      existing.attributes = info.attributes;
    }
    return createExternalSpanHandle(id);
  }

  scope.spans.push({
    id,
    parentId: resolveExternalParentId(info.parentId),
    caseId: scope.caseId,
    kind: info.kind,
    name: info.name,
    startedAt: toIsoTimestamp(info.startedAt),
    endedAt: null,
    status: 'running',
    attributes: info.attributes,
  });
  recordSpanForActiveCacheRecording(scope, id);

  return createExternalSpanHandle(id);
}

function updateExternalSpan(info: TraceExternalSpanUpdateInfo): void {
  const scope = getCurrentScope();
  if (!scope) return;
  const span = findSpan(scope, info.id);
  if (!span) return;
  if (info.name !== undefined) span.name = info.name;
  if (info.status !== undefined) span.status = info.status;
  if (info.error !== undefined) span.error = info.error;
  if (info.warning !== undefined) span.warning = info.warning;
  if (info.warnings !== undefined) span.warnings = info.warnings;
  if (info.attributes !== undefined) {
    mergeSpanAttributes(span, info.attributes);
  }
}

function endExternalSpan(info: TraceExternalSpanEndInfo): void {
  const scope = getCurrentScope();
  if (!scope) return;
  const span = findSpan(scope, info.id);
  if (!span) return;

  updateExternalSpan(info);
  span.status = info.status ?? (info.error ? 'error' : 'ok');
  span.endedAt = toIsoTimestamp(info.endedAt);
}

function recordExternalSpan(info: TraceExternalSpanRecordInfo): string {
  const id = info.id ?? generateSpanId();
  const scope = getCurrentScope();
  if (!scope) return id;

  const startedAt = toIsoTimestamp(info.startedAt);
  const endedAt =
    info.endedAt === null
      ? null
      : info.endedAt
        ? toIsoTimestamp(info.endedAt)
        : startedAt;
  const existing = findSpan(scope, id);
  const status = info.status ?? (info.error ? 'error' : 'ok');

  if (existing) {
    existing.parentId = resolveExternalParentId(info.parentId);
    existing.kind = info.kind;
    existing.name = info.name;
    existing.startedAt = startedAt;
    existing.endedAt = endedAt;
    existing.status = status;
    existing.attributes = info.attributes;
    existing.error = info.error;
    existing.warning = info.warning;
    existing.warnings = info.warnings;
    return id;
  }

  scope.spans.push({
    id,
    parentId: resolveExternalParentId(info.parentId),
    caseId: scope.caseId,
    kind: info.kind,
    name: info.name,
    startedAt,
    endedAt,
    status,
    attributes: info.attributes,
    error: info.error,
    warning: info.warning,
    warnings: info.warnings,
  });
  recordSpanForActiveCacheRecording(scope, id);

  return id;
}

/**
 * Ambient handle for the active span in the current async context.
 *
 * Calls are no-ops when executed outside of `evalTracer.span(...)`.
 */
export const evalSpan: TraceActiveSpan = {
  setName(value) {
    updateCurrentSpan((currentSpan) => {
      currentSpan.name = value;
    });
  },
  setAttribute(key, value) {
    updateCurrentSpan((currentSpan) => {
      mergeSpanAttributes(currentSpan, { [key]: value });
    });
  },
  setAttributes(value) {
    updateCurrentSpan((currentSpan) => {
      mergeSpanAttributes(currentSpan, value);
    });
  },
  incrementAttribute(key, delta) {
    updateCurrentSpan((currentSpan) => {
      incrementSpanAttribute(currentSpan, key, delta);
    });
  },
  appendToAttribute(key, value) {
    updateCurrentSpan((currentSpan) => {
      appendToSpanAttribute(currentSpan, key, value);
    });
  },
  mergeAttribute(key, patch) {
    updateCurrentSpan((currentSpan) => {
      mergeSpanAttribute(currentSpan, key, patch);
    });
  },
};

/**
 * Attach one or more recoverable errors to the active eval span.
 *
 * By default the active span is marked as `error` even if its callback later
 * completes without throwing. Pass `'warning'` or `{ level: 'warning' }` as the
 * final argument to record the diagnostic without changing span status. Calls
 * outside `evalTracer.span(...)` are ignored.
 */
export function captureEvalSpanError(
  errorOrErrors: unknown,
  ...additionalErrorsOrOptions: readonly unknown[]
): void {
  const { additionalErrors, options } = splitCaptureEvalSpanErrorArgs(
    additionalErrorsOrOptions,
  );
  const capturedAt = new Date().toISOString();
  const level = options.level ?? 'error';
  if (level === 'warning') {
    const warnings = normalizeTraceWarnings(
      errorOrErrors,
      additionalErrors,
      capturedAt,
    );
    updateCurrentSpan((currentSpan) => {
      appendSpanWarnings(currentSpan, warnings);
    });
    return;
  }

  const errors = normalizeTraceErrors(
    errorOrErrors,
    additionalErrors,
    capturedAt,
  );
  updateCurrentSpan((currentSpan) => {
    appendSpanErrors(currentSpan, errors);
  });
}

type TraceSpanInfoBase = {
  kind: string;
  name: string;
  attributes?: Record<string, unknown>;
  /**
   * Whether this span should delay eval finalization when the returned promise
   * is not awaited by user code. Defaults to `true`.
   */
  waitForBackgroundJob?: boolean;
};

/** Info accepted by `evalTracer.span(info, fn)` when creating an uncached span. */
export type TraceSpanInfoUncached = TraceSpanInfoBase & { cache?: undefined };

/**
 * Info accepted by `evalTracer.span(info, fn)` when opting in to caching.
 *
 * Cached spans return `Promise<unknown>` because the replayed value is revived
 * from persisted cache data on hit. Narrow the value yourself when you need a
 * typed return.
 */
export type TraceSpanInfoCached = TraceSpanInfoBase & {
  cache: SpanCacheOptions;
};

/** Info accepted by `evalTracer.span(info, fn)`. */
export type TraceSpanInfo = TraceSpanInfoUncached | TraceSpanInfoCached;

function traceSpan<T>(
  info: TraceSpanInfoUncached,
  fn: () => Promise<T> | T,
): Promise<T>;
function traceSpan<T>(
  info: TraceSpanInfoUncached,
  fn: (span: TraceActiveSpan) => Promise<T> | T,
): Promise<T>;
function traceSpan(
  info: TraceSpanInfoCached,
  fn: () => unknown,
): Promise<unknown>;
function traceSpan(
  info: TraceSpanInfoCached,
  fn: (span: TraceActiveSpan) => unknown,
): Promise<unknown>;
function traceSpan(
  info: TraceSpanInfo,
  fn: (span: TraceActiveSpan) => unknown,
): Promise<unknown> {
  const promise = traceSpanInternal(info, fn);
  const scope = getCurrentScope();
  if (!scope || info.waitForBackgroundJob === false) return promise;
  return startEvalBackgroundJob(promise);
}

async function traceSpanInternal(
  info: TraceSpanInfo,
  fn: (span: TraceActiveSpan) => unknown,
): Promise<unknown> {
  const scope = getCurrentScope();
  if (!scope) {
    return await fn(noopActiveSpan());
  }

  const id = generateSpanId();
  const parentId = getCurrentActiveSpan()?.id ?? null;
  const realStartedAt = getRealDateNowMs();

  const spanRecord: EvalTraceSpan = {
    id,
    parentId,
    caseId: scope.caseId,
    kind: info.kind,
    name: info.name,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    attributes: info.attributes,
  };

  scope.spans.push(spanRecord);
  recordSpanForActiveCacheRecording(scope, id);

  const activeSpan = createSpanHandle(spanRecord);

  return await runWithActiveSpan(spanRecord, async () => {
    try {
      const cacheOpts = info.cache;
      const cacheCtx = scope.cacheContext;
      if (
        cacheOpts !== undefined &&
        cacheCtx !== undefined &&
        scope.replayingDepth === 0
      ) {
        const ctx = cacheCtx;
        const namespace = getRequiredSpanCacheNamespace(cacheOpts);
        const cacheAdapter = getCacheAdapterForStorage(ctx, cacheOpts.storage);
        const keyHash = await hashCacheKey(
          { namespace, key: cacheOpts.key },
          { serializeFileBytes: cacheOpts.serializeFileBytes === true },
        );
        const canRead = ctx.mode === 'use' && ctx.read !== false;
        const canStore = ctx.mode !== 'bypass' && ctx.store !== false;

        mergeSpanAttributes(spanRecord, {
          'cache.key': keyHash,
          'cache.namespace': namespace,
          ...(cacheOpts.storage === 'temporary'
            ? { 'cache.storage': 'temporary' }
            : {}),
        });

        if (canRead) {
          const hit = await cacheAdapter.lookup(namespace, keyHash);
          if (hit) {
            const storedAt = hit.storedAt;
            const age = getRealDateNowMs() - new Date(storedAt).getTime();
            mergeSpanAttributes(spanRecord, {
              'cache.status': 'hit',
              'cache.storedAt': storedAt,
              'cache.age': age,
            });
            const recording = deserializeCacheRecording(hit.recording);
            replayRecording(scope, spanRecord, recording, { generateSpanId });
            spanRecord.status =
              recording.finalStatus ??
              (hasSpanError(spanRecord) ? 'error' : 'ok');
            spanRecord.endedAt = addElapsedMsToTimestamp(
              spanRecord.startedAt,
              getRealDateNowMs() - realStartedAt,
            );
            return recording.returnValue;
          }
          mergeSpanAttributes(spanRecord, {
            'cache.status': 'miss',
            ...(canStore ? {} : { 'cache.stored': false }),
          });
        } else if (ctx.mode === 'use' && canStore) {
          mergeSpanAttributes(spanRecord, {
            'cache.status': 'miss',
            'cache.read': false,
          });
        } else if (ctx.mode === 'refresh') {
          mergeSpanAttributes(spanRecord, {
            'cache.status': 'refresh',
            ...(canStore ? {} : { 'cache.stored': false }),
          });
        } else {
          mergeSpanAttributes(spanRecord, { 'cache.status': 'bypass' });
        }

        const frame: CacheRecordingFrame = {
          baseSpanIndex: scope.spans.length,
          replayParentSpanId: id,
          spanIds: new Set<string>(),
          finalAttributes: copyNonCacheAttributes(spanRecord.attributes),
          ops: [],
        };

        const bodyResult = await runWithCacheRecordingFrame(frame, async () => {
          return await fn(activeSpan);
        });

        appendSubSpanOps(scope, frame);
        finishSpanWithoutThrownError(spanRecord, realStartedAt);

        if (canStore) {
          const recording: CacheRecording = {
            returnValue: bodyResult,
            finalAttributes: frame.finalAttributes,
            finalStatus: spanRecord.status,
            finalError: spanRecord.error,
            finalErrors: spanRecord.errors,
            finalWarning: spanRecord.warning,
            finalWarnings: spanRecord.warnings,
            ops: frame.ops,
          };
          const entry: CacheEntry = {
            version: 1,
            key: keyHash,
            namespace,
            operationType: 'span',
            operationName: info.name,
            spanName: info.name,
            spanKind: info.kind,
            storedAt: new Date(getRealDateNowMs()).toISOString(),
            recording: await serializeCacheRecording(recording, {
              externalJsonStore: cacheAdapter.externalJsonStore,
            }),
          };
          await cacheAdapter.write(entry, {
            rawKey: cacheOpts.key,
            operationType: 'span',
            operationName: info.name,
          });
        }

        return bodyResult;
      }

      const result = await fn(activeSpan);
      finishSpanWithoutThrownError(spanRecord, realStartedAt);
      return result;
    } catch (error) {
      spanRecord.status = 'error';
      spanRecord.endedAt = addElapsedMsToTimestamp(
        spanRecord.startedAt,
        getRealDateNowMs() - realStartedAt,
      );
      spanRecord.error = normalizeTraceError(error);
      throw error;
    }
  });
}

function getRequiredSpanCacheNamespace(cacheOpts: unknown): string {
  if (!isRecordLike(cacheOpts)) {
    throw new Error('Cached spans require a non-empty cache.namespace');
  }
  const namespace = cacheOpts.namespace;
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new Error('Cached spans require a non-empty cache.namespace');
  }
  return namespace;
}

const traceCache = createTraceCache(generateSpanId);

/**
 * Trace builder used to create hierarchical spans and checkpoints during eval
 * execution.
 */
export const evalTracer = {
  /** Run a callback inside a new trace span and record its lifecycle. */
  span: traceSpan,

  /**
   * Cache a pure value without creating a trace span.
   *
   * When called inside an active span, the span receives a `cache.refs` entry
   * describing the value cache status for this run.
   */
  cache: traceCache,

  /**
   * Start a span whose lifecycle is controlled by an external tracer/exporter.
   *
   * Calls are no-ops outside an eval case scope, except that a generated or
   * caller-provided id is still returned for ergonomic adapter code.
   */
  startSpan: startExternalSpan,

  /**
   * Merge updates into an externally managed span that was started earlier.
   *
   * This is intended for observability exporters that receive span update
   * events before the final end event.
   */
  updateSpan: updateExternalSpan,

  /**
   * Finish an externally managed span and attach final attributes or errors.
   *
   * Missing spans are ignored so exporter adapters can safely forward events
   * even when they are emitted outside an eval case scope.
   */
  endSpan: endExternalSpan,

  /**
   * Record a complete external span in one call.
   *
   * Use this when an upstream tracer only exposes completed spans rather than
   * start/update/end events.
   */
  recordSpan: recordExternalSpan,

  /** Record a named point-in-time value alongside the trace. */
  checkpoint(name: string, data: unknown): void {
    const scope = getCurrentScope();
    if (!scope) return;
    scope.checkpoints.set(name, data);
    const id = generateSpanId();
    const parentId = getCurrentActiveSpan()?.id ?? null;
    scope.spans.push({
      id,
      parentId,
      caseId: scope.caseId,
      kind: 'checkpoint',
      name,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: 'ok',
      attributes: { value: data },
    });
    recordSpanForActiveCacheRecording(scope, id);
    recordCacheRecordingOpIfActive(scope, { kind: 'checkpoint', name, data });
  },
};

/** Build a queryable trace tree helper from a flat span list and checkpoints. */
export function buildTraceTree(
  spans: EvalTraceSpan[],
  checkpoints: Map<string, unknown>,
): EvalTraceTree {
  const rootSpans = spans.filter((s) => s.parentId === null);
  const flattenDfs = (): EvalTraceSpan[] => {
    const result: EvalTraceSpan[] = [];
    function visit(parentId: string | null) {
      for (const childSpan of spans) {
        if (childSpan.parentId === parentId) {
          result.push(childSpan);
          visit(childSpan.id);
        }
      }
    }
    visit(null);
    return result;
  };
  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
  };
  const readRecordValue = (
    value: unknown,
    key: string,
  ): Record<string, unknown> | undefined => {
    if (!isRecord(value)) return undefined;
    const child = value[key];
    return isRecord(child) ? child : undefined;
  };
  const readStringValue = (value: unknown, key: string): string | undefined => {
    if (!isRecord(value)) return undefined;
    const child = value[key];
    return typeof child === 'string' && child.length > 0 ? child : undefined;
  };
  const readValue = (value: unknown, key: string) => {
    if (!isRecord(value)) return undefined;
    return value[key];
  };
  const parseMaybeJson = (value: unknown) => {
    if (typeof value !== 'string') return value;
    const parsed = resultify((): unknown => JSON.parse(value));
    return parsed.error ? value : parsed.value;
  };
  const firstDefined = (values: unknown[]) => {
    return values.find((value) => value !== undefined);
  };
  const getToolCallMetadata = (span: EvalTraceSpan) => {
    const attributes = span.attributes;
    const genAI = readRecordValue(attributes, 'genAI');
    const mastra = readRecordValue(attributes, 'mastra');
    const toolAttributes = readRecordValue(attributes, 'attributes');
    return { attributes, genAI, mastra, toolAttributes };
  };
  const isToolCallSpan = (span: EvalTraceSpan) => {
    const { attributes, genAI, mastra } = getToolCallMetadata(span);
    return (
      span.kind === 'tool' ||
      span.kind === 'tool_call' ||
      readStringValue(attributes, 'gen_ai.tool.type') === 'tool' ||
      readStringValue(genAI, 'gen_ai.tool.type') === 'tool' ||
      readStringValue(genAI, 'mastra.span.type') === 'tool_call' ||
      readStringValue(mastra, 'type') === 'tool_call' ||
      readStringValue(mastra, 'entityType') === 'tool'
    );
  };
  const getToolCallIdentityNames = (span: EvalTraceSpan) => {
    const { attributes, genAI, mastra } = getToolCallMetadata(span);
    return [
      readStringValue(attributes, 'gen_ai.tool.name'),
      readStringValue(genAI, 'gen_ai.tool.name'),
      readStringValue(mastra, 'entityName'),
      readStringValue(mastra, 'entityId'),
      span.name,
    ].filter((name) => name !== undefined);
  };
  const getPreferredToolCallName = (span: EvalTraceSpan) => {
    return getToolCallIdentityNames(span)[0] ?? span.name;
  };
  const toolCallSpanMatchesName = (span: EvalTraceSpan, toolName: string) => {
    return getToolCallIdentityNames(span).includes(toolName);
  };
  const countToolCallSpans = (toolName: string) => {
    return spans.filter((span) => {
      return isToolCallSpan(span) && toolCallSpanMatchesName(span, toolName);
    }).length;
  };
  const buildToolCallSpan = (span: EvalTraceSpan) => {
    const { attributes, genAI, toolAttributes } = getToolCallMetadata(span);
    return {
      name: getPreferredToolCallName(span),
      spanName: span.name,
      kind: span.kind,
      arguments: parseMaybeJson(
        firstDefined([
          readValue(attributes, 'gen_ai.tool.call.arguments'),
          readValue(genAI, 'gen_ai.tool.call.arguments'),
          readValue(attributes, 'arguments'),
          readValue(attributes, 'input'),
        ]),
      ),
      result: parseMaybeJson(
        firstDefined([
          readValue(attributes, 'gen_ai.tool.call.result'),
          readValue(genAI, 'gen_ai.tool.call.result'),
          readValue(attributes, 'result'),
          readValue(attributes, 'output'),
        ]),
      ),
      description:
        readStringValue(attributes, 'gen_ai.tool.description') ??
        readStringValue(genAI, 'gen_ai.tool.description') ??
        readStringValue(toolAttributes, 'toolDescription'),
      toolType:
        readStringValue(attributes, 'gen_ai.tool.type') ??
        readStringValue(genAI, 'gen_ai.tool.type') ??
        readStringValue(toolAttributes, 'toolType'),
      attributes,
      span,
    };
  };
  const filterSpanNames = (
    sourceSpans: EvalTraceSpan[],
    kind: string | undefined,
  ): string[] => {
    return sourceSpans
      .filter((span) => kind === undefined || span.kind === kind)
      .map((span) => span.name);
  };

  return {
    spans,
    rootSpans,
    findSpan(name) {
      return spans.find((s) => s.name === name);
    },
    findSpans(name) {
      return spans.filter((s) => s.name === name);
    },
    hasSpan(name) {
      return spans.some((s) => s.name === name);
    },
    findSpansByKind(kind) {
      return spans.filter((s) => s.kind === kind);
    },
    findToolCallSpans() {
      return spans.filter(isToolCallSpan);
    },
    listToolCallSpanNames() {
      return spans.filter(isToolCallSpan).map(getPreferredToolCallName);
    },
    hasToolCallSpan(name) {
      return spans.some((s) => {
        return isToolCallSpan(s) && toolCallSpanMatchesName(s, name);
      });
    },
    getToolCallSpans(name) {
      return spans
        .filter((span) => {
          return isToolCallSpan(span) && toolCallSpanMatchesName(span, name);
        })
        .map(buildToolCallSpan);
    },
    getToolCallSpanCount(toolName) {
      return countToolCallSpans(toolName);
    },
    hasToolCallSpanCount(toolName, expectedCalls) {
      return countToolCallSpans(toolName) === expectedCalls;
    },
    listSpanNames(kind) {
      return filterSpanNames(spans, kind);
    },
    listSpanNamesDfs(kind) {
      return filterSpanNames(flattenDfs(), kind);
    },
    flattenDfs() {
      return flattenDfs();
    },
    checkpoints,
  };
}
