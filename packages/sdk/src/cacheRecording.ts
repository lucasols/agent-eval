import type {
  CacheRecording,
  CacheRecordingOp,
  EvalTraceSpan,
  SerializedCacheSpan,
  TraceCacheRef,
} from '@agent-evals/shared';
import { cloneCacheValue } from './cacheSerialization.ts';
import type { CacheRecordingFrame, EvalCaseScope } from './runtime.ts';

export type { TraceCacheRef } from '@agent-evals/shared';

type ReplayRecordingOptions = { generateSpanId(): string };

function mergeSpanAttributes(
  span: EvalTraceSpan,
  attributes: Record<string, unknown>,
): void {
  span.attributes = { ...span.attributes, ...attributes };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueKind(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value;
}

function copyArray(value: unknown[]): unknown[] {
  return value.map((item: unknown) => item);
}

export function stripCacheAttributes(
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

export async function snapshotNonCacheAttributes(
  span: EvalTraceSpan | undefined,
): Promise<Record<string, unknown>> {
  const snapshot = await cloneCacheValue(
    stripCacheAttributes(span?.attributes),
  );
  return isRecordLike(snapshot) ? snapshot : {};
}

export function diffNonCacheAttributes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (!cacheAttributeValuesEqual(before[key], value)) {
      result[key] = value;
    }
  }
  return result;
}

function cacheAttributeValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function appendCacheRef(
  span: EvalTraceSpan | undefined,
  ref: TraceCacheRef,
): void {
  if (span === undefined) return;
  const existing = span.attributes?.['cache.refs'];
  const existingRefs = Array.isArray(existing) ? copyArray(existing) : [];
  mergeSpanAttributes(span, { 'cache.refs': [...existingRefs, ref] });
}

/**
 * Record a cache ref against the active span when present, or against the
 * case scope's `caseCacheRefs` bucket when the call originated from outside
 * any `traceSpan(...)` body. Without this, spanless refs would be silently
 * dropped and never surface in the trace or case detail.
 */
export function recordCacheRef(
  scope: EvalCaseScope,
  span: EvalTraceSpan | undefined,
  ref: TraceCacheRef,
): void {
  if (span !== undefined) {
    appendCacheRef(span, ref);
    return;
  }
  scope.caseCacheRefs.push(ref);
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
      errors: undefined,
      warning: undefined,
      warnings: undefined,
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
    errors: original.errors,
    warning: original.warning,
    warnings: original.warnings,
    children,
  };
}

export function appendSubSpanOps(
  scope: EvalCaseScope,
  frame: CacheRecordingFrame,
): void {
  for (let i = frame.baseSpanIndex; i < scope.spans.length; i++) {
    const candidate = scope.spans[i];
    if (candidate?.parentId === frame.replayParentSpanId) {
      frame.ops.push({
        kind: 'subSpan',
        span: serializeSubSpanTree(scope, candidate.id),
      });
    }
  }
}

export function replayRecording(
  scope: EvalCaseScope,
  parentSpan: EvalTraceSpan | undefined,
  recording: CacheRecording,
  options: ReplayRecordingOptions,
): void {
  scope.replayingDepth++;
  try {
    for (const op of recording.ops) {
      applyRecordingOp(scope, parentSpan, op, options);
    }
    if (
      parentSpan !== undefined &&
      Object.keys(recording.finalAttributes).length > 0
    ) {
      mergeSpanAttributes(parentSpan, recording.finalAttributes);
    }
    if (parentSpan !== undefined && recording.finalError !== undefined) {
      parentSpan.error = recording.finalError;
    }
    if (parentSpan !== undefined && recording.finalErrors !== undefined) {
      parentSpan.errors = recording.finalErrors;
    }
    if (parentSpan !== undefined && recording.finalWarning !== undefined) {
      parentSpan.warning = recording.finalWarning;
    }
    if (parentSpan !== undefined && recording.finalWarnings !== undefined) {
      parentSpan.warnings = recording.finalWarnings;
    }
  } finally {
    scope.replayingDepth--;
  }
}

function applyRecordingOp(
  scope: EvalCaseScope,
  parentSpan: EvalTraceSpan | undefined,
  op: CacheRecordingOp,
  options: ReplayRecordingOptions,
): void {
  if (op.kind === 'setOutput') {
    scope.outputs[op.key] = op.value;
    if (op.column !== undefined) {
      scope.outputColumnOverrides[op.key] = op.column;
    }
    return;
  }
  if (op.kind === 'appendOutput') {
    const existing = scope.outputs[op.key];
    if (existing === undefined) {
      scope.outputs[op.key] = [op.value];
    } else if (Array.isArray(existing)) {
      scope.outputs[op.key] = [...copyArray(existing), op.value];
    } else {
      scope.outputs[op.key] = [existing, op.value];
    }
    return;
  }
  if (op.kind === 'mergeOutput') {
    const existing = scope.outputs[op.key];
    if (existing === undefined) {
      scope.outputs[op.key] = { ...op.patch };
    } else if (isRecordLike(existing)) {
      scope.outputs[op.key] = { ...existing, ...op.patch };
    } else {
      const message = `replay mergeEvalOutput("${op.key}"): existing value is ${valueKind(existing)}, expected object`;
      scope.assertionFailures.push({ message });
      scope.assertions.push({ message, status: 'fail' });
    }
    return;
  }
  if (op.kind === 'incrementOutput') {
    const existing = scope.outputs[op.key];
    if (existing === undefined) {
      scope.outputs[op.key] = op.delta;
    } else if (typeof existing === 'number') {
      scope.outputs[op.key] = existing + op.delta;
    } else {
      const message = `replay incrementEvalOutput("${op.key}"): existing value is ${valueKind(existing)}, expected number`;
      scope.assertionFailures.push({ message });
      scope.assertions.push({ message, status: 'fail' });
    }
    return;
  }
  if (op.kind === 'checkpoint') {
    scope.checkpoints.set(op.name, op.data);
    return;
  }
  replaySerializedSpan(scope, parentSpan?.id ?? null, op.span, options);
}

function replaySerializedSpan(
  scope: EvalCaseScope,
  parentId: string | null,
  serialized: SerializedCacheSpan,
  options: ReplayRecordingOptions,
): void {
  const id = options.generateSpanId();
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
    errors: serialized.errors,
    warning: serialized.warning,
    warnings: serialized.warnings,
  };
  scope.spans.push(replayed);
  for (const child of serialized.children) {
    replaySerializedSpan(scope, id, child, options);
  }
}
