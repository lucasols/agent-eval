import type { EvalTraceSpan } from '@agent-evals/shared';
import {
  findDiagnosticOutputMatch,
  formatDiagnosticOutputMessage,
  type DiagnosticOutputMatch,
} from '#src/utils/outputDiagnostics';

type VisibleRow = { span: EvalTraceSpan; depth: number; hasChildren: boolean };

export type TraceNestingMode = 'parent' | 'timeline';

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

type SpanTiming = {
  span: EvalTraceSpan;
  startMs: number | null;
  endMs: number | null;
  index: number;
  durationMs: number;
};

function getTimestampMs(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSpanTimings(spans: EvalTraceSpan[]): SpanTiming[] {
  return spans.map((span, index): SpanTiming => {
    const startMs = getTimestampMs(span.startedAt);
    const endMs = getTimestampMs(span.endedAt);
    const durationMs =
      startMs === null || endMs === null
        ? Number.POSITIVE_INFINITY
        : endMs - startMs;

    return { span, startMs, endMs, index, durationMs };
  });
}

function hasOriginalAncestor(
  span: EvalTraceSpan,
  ancestorId: string,
  spansById: Map<string, EvalTraceSpan>,
): boolean {
  let nextParentId = span.parentId;
  const visited = new Set<string>();

  while (nextParentId !== null) {
    if (nextParentId === ancestorId) return true;
    if (visited.has(nextParentId)) return false;
    visited.add(nextParentId);

    const parent = spansById.get(nextParentId);
    if (!parent) return false;
    nextParentId = parent.parentId;
  }

  return false;
}

function canNestByTimeline(child: SpanTiming, parent: SpanTiming): boolean {
  if (child.span.id === parent.span.id) return false;
  if (child.startMs === null || parent.startMs === null) return false;
  if (parent.startMs > child.startMs) return false;
  if (parent.startMs === child.startMs && parent.index > child.index) {
    return false;
  }
  if (parent.endMs !== null && parent.endMs <= child.startMs) return false;
  if (
    parent.span.kind === child.span.kind &&
    parent.startMs === child.startMs &&
    parent.durationMs <= child.durationMs
  ) {
    return false;
  }
  return true;
}

function isBetterTimelineParent(
  candidate: SpanTiming,
  current: SpanTiming,
): boolean {
  const candidateStart = candidate.startMs ?? Number.NEGATIVE_INFINITY;
  const currentStart = current.startMs ?? Number.NEGATIVE_INFINITY;
  if (candidateStart !== currentStart) return candidateStart > currentStart;
  if (candidate.durationMs !== current.durationMs) {
    return candidate.durationMs < current.durationMs;
  }
  return candidate.index > current.index;
}

function getTimelineParentIds(
  spans: EvalTraceSpan[],
): Map<string, string | null> {
  const spansById = new Map(spans.map((span) => [span.id, span]));
  const timings = getSpanTimings(spans);
  const timingsById = new Map(
    timings.map((timing) => [timing.span.id, timing]),
  );
  const parentIds = new Map<string, string | null>();

  for (const timing of timings) {
    let parentTiming =
      timing.span.parentId === null
        ? undefined
        : timingsById.get(timing.span.parentId);

    for (const candidate of timings) {
      if (!canNestByTimeline(timing, candidate)) continue;
      if (hasOriginalAncestor(candidate.span, timing.span.id, spansById)) {
        continue;
      }
      if (
        parentTiming === undefined ||
        isBetterTimelineParent(candidate, parentTiming)
      ) {
        parentTiming = candidate;
      }
    }

    parentIds.set(timing.span.id, parentTiming?.span.id ?? null);
  }

  return parentIds;
}

export function buildTraceChildrenByParent(
  spans: EvalTraceSpan[],
  nestingMode: TraceNestingMode,
): Map<string | null, EvalTraceSpan[]> {
  const parentIds =
    nestingMode === 'timeline' ? getTimelineParentIds(spans) : undefined;
  const spanIds = new Set(spans.map((span) => span.id));
  const map = new Map<string | null, EvalTraceSpan[]>();

  for (const span of spans) {
    const candidateParentId = parentIds?.get(span.id) ?? span.parentId;
    const parentId =
      candidateParentId === null || spanIds.has(candidateParentId)
        ? candidateParentId
        : null;
    const list = map.get(parentId);
    if (list) list.push(span);
    else map.set(parentId, [span]);
  }

  const sortByStart = (a: EvalTraceSpan, b: EvalTraceSpan) =>
    Date.parse(a.startedAt) - Date.parse(b.startedAt);
  for (const list of map.values()) list.sort(sortByStart);

  return map;
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

export function formatSpanDiagnosticTooltip(
  span: EvalTraceSpan,
  tone: 'error' | 'warning',
): string {
  const diagnostic =
    tone === 'error'
      ? (span.error ?? span.errors?.at(-1))
      : (span.warning ?? span.warnings?.at(-1));
  if (diagnostic === undefined) {
    return tone === 'error' ? 'Errored span' : 'Warning span';
  }

  const label =
    diagnostic.name && diagnostic.name !== 'Error'
      ? diagnostic.name
      : tone === 'error'
        ? 'Error'
        : 'Warning';
  return `${label}: ${diagnostic.message}`;
}

export function formatSpanOutputDiagnosticTooltip(
  match: DiagnosticOutputMatch,
): string {
  return formatDiagnosticOutputMessage(match);
}

export function getSpanOutputDiagnosticMatch(
  span: EvalTraceSpan,
): DiagnosticOutputMatch | undefined {
  return findDiagnosticOutputMatch(span.attributes?.output);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
