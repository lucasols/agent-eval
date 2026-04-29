import type { EvalTraceSpan } from '@agent-evals/shared';

type VisibleRow = { span: EvalTraceSpan; depth: number; hasChildren: boolean };

type TraceMetrics = {
  startMs: number;
  totalMs: number;
  endMs: number;
  nowMs: number;
};

export type SpanBar = {
  leftPct: number;
  widthPct: number;
  durationMs: number;
  isRunning: boolean;
};

export function computeTraceMetrics(spans: EvalTraceSpan[]): TraceMetrics {
  const nowMs = Date.now();
  if (spans.length === 0) {
    return { startMs: nowMs, endMs: nowMs, totalMs: 1, nowMs };
  }
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    const spanStart = Date.parse(span.startedAt);
    if (Number.isFinite(spanStart) && spanStart < startMs) startMs = spanStart;
    const spanEnd = span.endedAt ? Date.parse(span.endedAt) : nowMs;
    if (Number.isFinite(spanEnd) && spanEnd > endMs) endMs = spanEnd;
  }
  if (!Number.isFinite(startMs)) startMs = nowMs;
  if (!Number.isFinite(endMs)) endMs = nowMs;
  const totalMs = Math.max(1, endMs - startMs);
  return { startMs, endMs, totalMs, nowMs };
}

export function computeSpanBar(
  span: EvalTraceSpan,
  metrics: TraceMetrics,
): SpanBar {
  const spanStart = Date.parse(span.startedAt);
  const isRunning = span.endedAt === null;
  const spanEnd = span.endedAt ? Date.parse(span.endedAt) : metrics.nowMs;
  const safeStart = Number.isFinite(spanStart) ? spanStart : metrics.startMs;
  const safeEnd = Number.isFinite(spanEnd) ? spanEnd : metrics.endMs;
  const durationMs = Math.max(0, safeEnd - safeStart);
  const leftPctRaw = ((safeStart - metrics.startMs) / metrics.totalMs) * 100;
  const widthPctRaw = (durationMs / metrics.totalMs) * 100;
  const leftPct = clamp(leftPctRaw, 0, 100);
  const widthPct = clamp(widthPctRaw, 0, Math.max(0, 100 - leftPct));
  return { leftPct, widthPct, durationMs, isRunning };
}

export function flattenVisibleRows(
  childrenByParent: Map<string | null, EvalTraceSpan[]>,
  collapsed: Set<string>,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const roots = childrenByParent.get(null) ?? [];

  function walk(span: EvalTraceSpan, depth: number) {
    const children = childrenByParent.get(span.id) ?? [];
    rows.push({ span, depth, hasChildren: children.length > 0 });
    if (collapsed.has(span.id)) return;
    for (const child of children) walk(child, depth + 1);
  }

  for (const root of roots) walk(root, 0);
  return rows;
}

export function buildRulerTicks(
  totalMs: number,
): { pct: number; label: string }[] {
  return [0, 25, 50, 75, 100].map((pct) => ({
    pct,
    label: formatSpanDuration(Math.round((totalMs * pct) / 100)),
  }));
}

export function formatSpanDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
