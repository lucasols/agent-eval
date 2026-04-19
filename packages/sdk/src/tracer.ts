import { createHash } from 'node:crypto';
import type {
  CacheEntry,
  CacheRecording,
  CacheRecordingOp,
  EvalTraceSpan,
  SerializedCacheSpan,
  SpanCacheOptions,
} from '@agent-evals/shared';
import type { CacheRecordingFrame, EvalCaseScope } from './runtime.ts';
import { getCurrentScope } from './runtime.ts';
import type { EvalTraceTree } from './types.ts';

/**
 * Mutable handle for the current span.
 *
 * Prefer the ambient `span` export for most code so helpers deeper in the call
 * stack can annotate the active span without receiving an injected argument.
 */
export type TraceActiveSpan = {
  /** Rename the active span after it has been created. */
  setName(value: string): void;
  /** Set a single attribute on the active span. Later writes replace the same key. */
  setAttribute(key: string, value: unknown): void;
  /** Merge multiple attributes into the active span. */
  setAttributes(value: Record<string, unknown>): void;
};

let spanIdCounter = 0;

function generateSpanId(): string {
  spanIdCounter++;
  return `span_${String(Date.now())}_${String(spanIdCounter)}`;
}

function updateCurrentSpan(update: (currentSpan: EvalTraceSpan) => void): void {
  const scope = getCurrentScope();
  const currentSpan = scope?.activeSpanStack.at(-1);
  if (!currentSpan) return;
  update(currentSpan);
}

function noopActiveSpan(): TraceActiveSpan {
  return {
    setName() {},
    setAttribute() {},
    setAttributes() {},
  };
}

function mergeSpanAttributes(
  span: EvalTraceSpan,
  attributes: Record<string, unknown>,
): void {
  span.attributes = { ...span.attributes, ...attributes };
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
  };
}

/**
 * Ambient handle for the active span in the current async context.
 *
 * Calls are no-ops when executed outside of `tracer.span(...)`.
 */
export const span: TraceActiveSpan = {
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
};

type TraceSpanInfoBase = {
  kind: EvalTraceSpan['kind'];
  name: string;
  attributes?: Record<string, unknown>;
};

/** Info accepted by `tracer.span(info, fn)` when creating an uncached span. */
export type TraceSpanInfoUncached = TraceSpanInfoBase & { cache?: undefined };

/**
 * Info accepted by `tracer.span(info, fn)` when opting in to caching.
 *
 * Cached spans return `Promise<unknown>` because the replayed value comes from
 * a JSON round-trip on cache hit. Narrow the value yourself when you need a
 * typed return.
 */
export type TraceSpanInfoCached = TraceSpanInfoBase & {
  cache: SpanCacheOptions;
};

/** Info accepted by `tracer.span(info, fn)`. */
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
async function traceSpan(
  info: TraceSpanInfo,
  fn: (span: TraceActiveSpan) => unknown,
): Promise<unknown> {
  const scope = getCurrentScope();
  if (!scope) {
    return await fn(noopActiveSpan());
  }

  const id = generateSpanId();
  const parentId = scope.activeSpanStack.at(-1)?.id ?? null;

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
  scope.spanStack.push(id);
  scope.activeSpanStack.push(spanRecord);

  const activeSpan = createSpanHandle(spanRecord);

  try {
    const cacheOpts = info.cache;
    const cacheCtx = scope.cacheContext;
    if (
      cacheOpts !== undefined
      && cacheCtx !== undefined
      && scope.replayingDepth === 0
    ) {
      const ctx = cacheCtx;
      const namespace = cacheOpts.namespace ?? `${ctx.evalId}__${info.name}`;
      const keyHash = hashCacheKey({
        namespace,
        codeFingerprint: ctx.codeFingerprint,
        key: cacheOpts.key,
      });

      mergeSpanAttributes(spanRecord, {
        'cache.key': keyHash,
        'cache.namespace': namespace,
      });

      if (ctx.mode === 'use') {
        const hit = await ctx.adapter.lookup(namespace, keyHash);
        if (hit) {
          const storedAt = hit.storedAt;
          const age = Date.now() - new Date(storedAt).getTime();
          mergeSpanAttributes(spanRecord, {
            'cache.status': 'hit',
            'cache.storedAt': storedAt,
            'cache.age': age,
          });
          replayRecording(scope, spanRecord, hit.recording);
          spanRecord.status = 'ok';
          spanRecord.endedAt = new Date().toISOString();
          return hit.recording.returnValue;
        }
        mergeSpanAttributes(spanRecord, { 'cache.status': 'miss' });
      } else if (ctx.mode === 'refresh') {
        mergeSpanAttributes(spanRecord, { 'cache.status': 'refresh' });
      } else {
        mergeSpanAttributes(spanRecord, { 'cache.status': 'bypass' });
      }

      const frame: CacheRecordingFrame = {
        baseSpanIndex: scope.spans.length,
        cachedSpanId: id,
        ops: [],
      };
      scope.recordingStack.push(frame);

      let bodyResult: unknown;
      try {
        bodyResult = await fn(activeSpan);
      } finally {
        scope.recordingStack.pop();
      }

      appendSubSpanOps(scope, frame);

      if (ctx.mode !== 'bypass') {
        const returnValue = toJsonSafe(bodyResult);
        const recording: CacheRecording = {
          returnValue,
          finalAttributes: stripCacheAttributes(spanRecord.attributes),
          ops: frame.ops,
        };
        const entry: CacheEntry = {
          version: 1,
          key: keyHash,
          namespace,
          spanName: info.name,
          spanKind: info.kind,
          storedAt: new Date().toISOString(),
          codeFingerprint: ctx.codeFingerprint,
          recording,
        };
        await ctx.adapter.write(entry);
      }

      spanRecord.status = 'ok';
      spanRecord.endedAt = new Date().toISOString();
      return bodyResult;
    }

    const result = await fn(activeSpan);
    spanRecord.status = 'ok';
    spanRecord.endedAt = new Date().toISOString();
    return result;
  } catch (error) {
    spanRecord.status = 'error';
    spanRecord.endedAt = new Date().toISOString();
    if (error instanceof Error) {
      spanRecord.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else {
      spanRecord.error = { message: String(error) };
    }
    throw error;
  } finally {
    scope.spanStack.pop();
    scope.activeSpanStack.pop();
  }
}

/**
 * Trace builder used to create hierarchical spans and checkpoints during eval
 * execution.
 */
export const tracer = {
  /** Run a callback inside a new trace span and record its lifecycle. */
  span: traceSpan,

  /** Record a named point-in-time value alongside the trace. */
  checkpoint(name: string, data: unknown): void {
    const scope = getCurrentScope();
    if (!scope) return;
    scope.checkpoints.set(name, data);
    const id = generateSpanId();
    const parentId = scope.spanStack.at(-1) ?? null;
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
    if (scope.replayingDepth === 0) {
      const top = scope.recordingStack.at(-1);
      if (top) top.ops.push({ kind: 'checkpoint', name, data });
    }
  },
};

/** Build a queryable trace tree helper from a flat span list and checkpoints. */
export function buildTraceTree(
  spans: EvalTraceSpan[],
  checkpoints: Map<string, unknown>,
): EvalTraceTree {
  const rootSpans = spans.filter((s) => s.parentId === null);

  return {
    spans,
    rootSpans,
    findSpan(name) {
      return spans.find((s) => s.name === name);
    },
    findSpansByKind(kind) {
      return spans.filter((s) => s.kind === kind);
    },
    flattenDfs() {
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
    },
    checkpoints,
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries: [string, unknown][] = Object.entries(value);
  entries.sort(([a], [b]) =>
    a < b ? -1
    : a > b ? 1
    : 0,
  );
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

/** Hash the components of a cache key into a deterministic hex digest. */
export function hashCacheKey(input: {
  namespace: string;
  codeFingerprint: string;
  key: unknown;
}): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function stripCacheAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!attributes) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.startsWith('cache.')) {
      result[key] = value;
    }
  }
  return result;
}

function serializeSubSpanTree(
  scope: EvalCaseScope,
  spanId: string,
): SerializedCacheSpan {
  const original = scope.spans.find((s) => s.id === spanId);
  if (!original) {
    return {
      kind: 'custom',
      name: 'unknown',
      attributes: undefined,
      status: 'ok',
      error: undefined,
      children: [],
    };
  }
  const children = scope.spans
    .filter((s) => s.parentId === spanId)
    .map((child) => serializeSubSpanTree(scope, child.id));
  return {
    kind: original.kind,
    name: original.name,
    attributes: original.attributes,
    status: original.status,
    error: original.error,
    children,
  };
}

function appendSubSpanOps(
  scope: EvalCaseScope,
  frame: CacheRecordingFrame,
): void {
  for (let i = frame.baseSpanIndex; i < scope.spans.length; i++) {
    const candidate = scope.spans[i];
    if (candidate?.parentId === frame.cachedSpanId) {
      frame.ops.push({
        kind: 'subSpan',
        span: serializeSubSpanTree(scope, candidate.id),
      });
    }
  }
}

function replayRecording(
  scope: EvalCaseScope,
  parentSpan: EvalTraceSpan,
  recording: CacheRecording,
): void {
  scope.replayingDepth++;
  try {
    for (const op of recording.ops) {
      applyRecordingOp(scope, parentSpan, op);
    }
    if (Object.keys(recording.finalAttributes).length > 0) {
      mergeSpanAttributes(parentSpan, recording.finalAttributes);
    }
  } finally {
    scope.replayingDepth--;
  }
}

function applyRecordingOp(
  scope: EvalCaseScope,
  parentSpan: EvalTraceSpan,
  op: CacheRecordingOp,
): void {
  if (op.kind === 'setOutput') {
    scope.outputs[op.key] = op.value;
    return;
  }
  if (op.kind === 'incrementOutput') {
    const existing = scope.outputs[op.key];
    if (existing === undefined) {
      scope.outputs[op.key] = op.delta;
    } else if (typeof existing === 'number') {
      scope.outputs[op.key] = existing + op.delta;
    } else {
      scope.assertionFailures.push(
        `replay incrementOutput("${op.key}"): existing value is ${typeof existing}, expected number`,
      );
    }
    return;
  }
  if (op.kind === 'checkpoint') {
    scope.checkpoints.set(op.name, op.data);
    return;
  }
  replaySerializedSpan(scope, parentSpan.id, op.span);
}

function replaySerializedSpan(
  scope: EvalCaseScope,
  parentId: string | null,
  serialized: SerializedCacheSpan,
): void {
  const id = generateSpanId();
  const now = new Date().toISOString();
  const replayed: EvalTraceSpan = {
    id,
    parentId,
    caseId: scope.caseId,
    kind: serialized.kind,
    name: serialized.name,
    startedAt: now,
    endedAt: now,
    status: serialized.status,
    attributes: serialized.attributes,
    error: serialized.error,
  };
  scope.spans.push(replayed);
  for (const child of serialized.children) {
    replaySerializedSpan(scope, id, child);
  }
}
