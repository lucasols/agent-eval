import type { EvalTraceSpan, TraceDisplayConfig } from '@agent-evals/shared';
import {
  ChevronRight,
  Clock3,
  CircleAlert,
  GitFork,
  PanelRightClose,
  PanelRightOpen,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { styled } from 'vindur';
import { SpanDetail } from '#src/components/SpanDetail';
import { Tooltip } from '#src/components/Tooltip';
import {
  buildTraceChildrenByParent,
  buildRulerTicks,
  buildSpanNameWildcardRegex,
  computeSpanBar,
  computeTraceMetrics,
  estimateTraceLabelWidth,
  flattenVisibleRows,
  formatSpanDiagnosticTooltip,
  formatSpanOutputDiagnosticTooltip,
  formatSpanDuration,
  getSpanOutputDiagnosticMatch,
  LABEL_COLUMN_MIN_WIDTH,
  type SpanBar,
  TIMELINE_COLUMN_MIN_WIDTH,
  type TraceNestingMode,
} from '#src/components/TraceTree.helpers';
import { TraceCacheBadge } from '#src/components/TraceTreeCacheBadge';
import {
  type FilteredSpanVisibility,
  type SpanKindFilterMode,
  TraceFilterToolbar,
} from '#src/components/TraceTreeFilters';
import {
  updateSearchParams,
  useSearchParams,
} from '#src/hooks/useSearchParams';
import { colors } from '#src/style/colors';
import { inline, monoFont, transition } from '#src/style/helpers';
import { formatCheckpointPreview } from '#src/utils/checkpointPreview';
import {
  formatTraceAttributeValue,
  getTraceAttributeItems,
} from '#src/utils/traceAttributes';
import {
  getTraceKindColors,
  getTraceKindStyle,
  type TraceKindStyle,
} from '#src/utils/traceKindColors';

const NARROW_BREAKPOINT = 720;
const TIMELINE_DURATION_LABEL_GAP = 6;
const TIMELINE_DURATION_LABEL_END_PADDING = 12;
const TIMELINE_DURATION_LABEL_MIN_RIGHT_PADDING = 32;
const TIMELINE_DURATION_LABEL_CHAR_WIDTH = 6;

type TraceKindBarStyle = TraceKindStyle & { left: string; width: string };

type CheckpointMarkerStyle = TraceKindStyle & { left: string };

function getTraceKindBarStyle(
  kindStyle: TraceKindStyle,
  bar: SpanBar,
): TraceKindBarStyle {
  return { ...kindStyle, left: `${bar.leftPct}%`, width: `${bar.widthPct}%` };
}

function getCheckpointMarkerStyle(
  kindStyle: TraceKindStyle,
  bar: SpanBar,
): CheckpointMarkerStyle {
  return { ...kindStyle, left: `${bar.leftPct}%` };
}

function formatSpanBarDuration(bar: SpanBar): string {
  return `${formatSpanDuration(bar.durationMs)}${bar.isRunning ? '…' : ''}`;
}

function estimateDurationLabelWidth(value: string): number {
  return Math.ceil(
    Array.from(value).length * TIMELINE_DURATION_LABEL_CHAR_WIDTH,
  );
}

const Root = styled.div`
  display: flex;
  gap: 12px;
  height: 100%;
  align-items: stretch;
  position: relative;
  min-width: 0;
`;

const TimelinePane = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  overflow: hidden;
`;

const DetailPane = styled.div`
  flex: 1 1 0;
  min-width: 300px;
  max-width: 460px;
  overflow: auto;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  padding: 14px 16px;
`;

const DetailOverlay = styled.div`
  position: absolute;
  inset: 0 0 0 auto;
  width: min(420px, 85%);
  display: flex;
  flex-direction: column;
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  box-shadow: -10px 0 28px rgba(10, 11, 13, 0.14);
  z-index: 2;
`;

const OverlayHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid ${colors.border.var};
  flex-shrink: 0;
`;

const OverlayLabel = styled.span`
  ${monoFont};
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${colors.textMuted.var};
`;

const OverlayBody = styled.div`
  overflow: auto;
  padding: 14px 16px;
`;

const CloseButton = styled.button`
  ${transition({ property: 'background, color' })}
  background: none;
  border: none;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textMuted.var};
  cursor: pointer;

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 14px;
    height: 14px;
  }
`;

const TimelineScroll = styled.div`
  flex: 1;
  overflow: auto;
  min-width: 0;
`;

const TimelineInner = styled.div<{ timelineCollapsed: boolean }>`
  display: flex;
  flex-direction: column;
  min-width: 560px;

  &.timelineCollapsed {
    min-width: 0;
  }
`;

const RulerRow = styled.div<{ timelineCollapsed: boolean }>`
  display: grid;
  grid-template-columns: minmax(200px, 40%) 1fr;
  flex-shrink: 0;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  height: 24px;
  position: sticky;
  top: 0;
  z-index: 1;

  &.timelineCollapsed {
    grid-template-columns: 1fr;
  }
`;

const RulerLabelInline = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 8 })}
  padding: 0 6px 0 10px;
  height: 100%;
`;

const RulerControls = styled.div`
  ${inline({ align: 'center', gap: 5 })}
  flex-shrink: 0;
`;

const NestingModeControl = styled.div`
  ${inline({ align: 'center' })}
  border: 1px solid ${colors.border.var};
  border-radius: 5px;
  overflow: hidden;
  background: ${colors.bg.var};
`;

const NestingModeButton = styled.button<{ active: boolean }>`
  ${transition({ property: 'background, color' })}
  width: 20px;
  height: 18px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-right: 1px solid ${colors.border.var};
  background: transparent;
  color: ${colors.textDim.var};
  cursor: pointer;

  &:last-child {
    border-right: none;
  }

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.surfaceActive.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 12px;
    height: 12px;
  }
`;

const TimelineToggle = styled.button`
  ${transition({ property: 'background, color' })}
  background: none;
  border: none;
  padding: 3px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textMuted.var};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 14px;
    height: 14px;
  }
`;

const RulerLabelText = styled.span`
  ${monoFont};
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${colors.textDim.var};
`;

const RulerTimelineCell = styled.div`
  position: relative;
  padding-right: 12px;
`;

const RulerTick = styled.span`
  ${monoFont};
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  color: ${colors.textDim.var};
  white-space: nowrap;
`;

const Rows = styled.div`
  padding: 4px 0;
`;

const Row = styled.div<{
  active: boolean;
  timelineCollapsed: boolean;
  isFaded: boolean;
}>`
  ${transition({ property: 'background, color' })}
  display: grid;
  grid-template-columns: minmax(200px, 40%) 1fr;
  align-items: stretch;
  cursor: pointer;
  font-size: 11.5px;
  min-height: 26px;
  border-left: 2px solid transparent;
  color: ${colors.textMuted.var};

  &.timelineCollapsed {
    grid-template-columns: 1fr;
  }

  &:hover {
    background: ${colors.bgElevated.var};
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.surface.var};
    color: ${colors.text.var};
    border-left-color: ${colors.accent.var};
  }

  &.isFaded {
    opacity: 0.34;
  }

  &.isFaded:hover {
    opacity: 0.65;
  }
`;

const LabelCell = styled.div`
  ${inline({ gap: 7, align: 'center' })}
  min-width: 0;
  overflow: hidden;
  padding-right: 10px;
`;

const TimelineCell = styled.div`
  position: relative;
  height: 26px;
  padding-right: 12px;

  background-image:
    linear-gradient(
      to right,
      transparent calc(25% - 1px),
      ${colors.border.alpha(0.7)} calc(25% - 1px),
      ${colors.border.alpha(0.7)} 25%,
      transparent 25%
    ),
    linear-gradient(
      to right,
      transparent calc(50% - 1px),
      ${colors.border.alpha(0.7)} calc(50% - 1px),
      ${colors.border.alpha(0.7)} 50%,
      transparent 50%
    ),
    linear-gradient(
      to right,
      transparent calc(75% - 1px),
      ${colors.border.alpha(0.7)} calc(75% - 1px),
      ${colors.border.alpha(0.7)} 75%,
      transparent 75%
    );
`;

const WaterfallBar = styled.div<{ isRunning: boolean; isError: boolean }>`
  position: absolute;
  top: 7px;
  height: 12px;
  min-width: 2px;
  border-radius: 3px;
  background: var(--trace-kind-bar-bg, ${colors.borderStrong.var});
  border: 1px solid transparent;

  &.isRunning {
    background: repeating-linear-gradient(
      45deg,
      var(--trace-kind-running-strong, ${colors.accent.alpha(0.4)}) 0,
      var(--trace-kind-running-strong, ${colors.accent.alpha(0.4)}) 6px,
      var(--trace-kind-running-soft, ${colors.accent.alpha(0.15)}) 6px,
      var(--trace-kind-running-soft, ${colors.accent.alpha(0.15)}) 12px
    );
  }

  &.isError {
    border-color: ${colors.error.var};
  }
`;

const CheckpointMarker = styled.div`
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--trace-kind-bar-bg, ${colors.borderStrong.var});
  box-shadow: 0 0 0 2px ${colors.bg.var};
  transform: translate(-50%, -50%) rotate(45deg);
  pointer-events: none;
`;

const BarDurationLabel = styled.span`
  ${monoFont};
  display: block;
  position: absolute;
  top: 5px;
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  color: ${colors.textMuted.var};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ToggleButton = styled.button<{ open: boolean }>`
  ${transition({ property: 'transform' })}
  background: none;
  border: none;
  padding: 0;
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};
  flex-shrink: 0;
  cursor: pointer;

  & > svg {
    width: 12px;
    height: 12px;
  }

  &.open > svg {
    transform: rotate(90deg);
  }
`;

const Spacer = styled.span`
  width: 14px;
  flex-shrink: 0;
`;

const KindBadge = styled.span`
  ${monoFont};
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--trace-kind-badge-text, ${colors.textMuted.var});
  background: var(--trace-kind-badge-bg, ${colors.surface.var});
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
`;

const SpanStatusIcon = styled.span<{ isError: boolean; isWarning: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: -3px;

  &.isError {
    color: ${colors.error.var};
  }

  &.isWarning {
    color: ${colors.warning.var};
  }

  & > svg {
    width: 12px;
    height: 12px;
    stroke-width: 2.6;
  }
`;

const SpanName = styled.span<{ isError: boolean; isWarning: boolean }>`
  font-weight: 500;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;

  &.isError {
    color: ${colors.error.var};
  }
  &.isWarning {
    color: ${colors.warning.var};
  }
`;

const TreeAttributeLabel = styled.span`
  ${monoFont};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  color: ${colors.textDim.var};
`;

const CheckpointPreview = styled.span`
  ${monoFont};
  font-size: 10px;
  color: ${colors.textMuted.var};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;

  &::before {
    content: '→';
    color: ${colors.textDim.var};
    margin-right: 4px;
  }
`;

const Empty = styled.div`
  padding: 16px;
  color: ${colors.textMuted.var};
  font-size: 12px;
  text-align: center;
`;

const ScopeBanner = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
  padding: 8px 10px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.accent.alpha(0.08)};
  color: ${colors.textMuted.var};
  font-size: 11.5px;
  flex-shrink: 0;
`;

const ScopeLabel = styled.div`
  ${inline({ align: 'center', gap: 6 })}
  min-width: 0;
`;

const ScopeName = styled.span`
  ${monoFont};
  color: ${colors.text.var};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ClearScopeButton = styled.button`
  ${transition({ property: 'background, color, border-color' })}
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  color: ${colors.textMuted.var};
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
  cursor: pointer;

  &:hover {
    color: ${colors.text.var};
    border-color: ${colors.borderStrong.var};
    background: ${colors.surfaceHover.var};
  }
`;

type TraceTreeProps = {
  spans: EvalTraceSpan[];
  traceDisplay: TraceDisplayConfig;
  spanSearchParamKey?: string;
  traceScopeSearchParamKey?: string;
};

const TIMELINE_COLLAPSED_STORAGE_KEY = 'agent-evals.trace-timeline-collapsed';
const TRACE_NESTING_MODE_STORAGE_KEY = 'agent-evals.trace-nesting-mode';
const SPAN_SEARCH_PARAM_KEY = 'span';
const TRACE_SCOPE_SEARCH_PARAM_KEY = 'traceScope';

function readTimelineCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(TIMELINE_COLLAPSED_STORAGE_KEY) === '1';
}

function readTraceNestingMode(): TraceNestingMode {
  if (typeof window === 'undefined') return 'timeline';
  const value = window.localStorage.getItem(TRACE_NESTING_MODE_STORAGE_KEY);
  return value === 'parent' || value === 'timeline' ? value : 'timeline';
}

function spanMatchesKindFilter(
  span: EvalTraceSpan,
  filterMode: SpanKindFilterMode,
  selectedKinds: Set<string>,
): boolean {
  if (filterMode === 'all') return true;
  if (selectedKinds.size === 0) return true;
  const selected = selectedKinds.has(span.kind);
  return filterMode === 'only' ? selected : !selected;
}

function getSubtreeSpanIds(spans: EvalTraceSpan[], rootSpanId: string) {
  const childIdsByParent = new Map<string, string[]>();
  for (const span of spans) {
    if (span.parentId === null) continue;
    const current = childIdsByParent.get(span.parentId);
    if (current === undefined) {
      childIdsByParent.set(span.parentId, [span.id]);
      continue;
    }
    current.push(span.id);
  }

  const ids = new Set<string>([rootSpanId]);
  const queue = [rootSpanId];
  for (let index = 0; index < queue.length; index++) {
    const parentId = queue[index];
    if (parentId === undefined) continue;
    for (const childId of childIdsByParent.get(parentId) ?? []) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      queue.push(childId);
    }
  }
  return ids;
}

export function TraceTree({
  spans,
  traceDisplay,
  spanSearchParamKey = SPAN_SEARCH_PARAM_KEY,
  traceScopeSearchParamKey = TRACE_SCOPE_SEARCH_PARAM_KEY,
}: TraceTreeProps) {
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [timelineCollapsed, setTimelineCollapsed] = useState<boolean>(
    readTimelineCollapsed,
  );
  const [traceNestingMode, setTraceNestingMode] =
    useState<TraceNestingMode>(readTraceNestingMode);
  const [spanKindFilterMode, setSpanKindFilterMode] =
    useState<SpanKindFilterMode>('all');
  const [filteredSpanVisibility, setFilteredSpanVisibility] =
    useState<FilteredSpanVisibility>('hidden');
  const [selectedSpanKinds, setSelectedSpanKinds] = useState<Set<string>>(
    () => new Set(),
  );
  const [spanNameFilterVisible, setSpanNameFilterVisible] = useState(false);
  const [spanNameFilterPattern, setSpanNameFilterPattern] = useState('');
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const selectedSpanId = searchParams.get(spanSearchParamKey);
  const traceScopeSpanId = searchParams.get(traceScopeSearchParamKey);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      TIMELINE_COLLAPSED_STORAGE_KEY,
      timelineCollapsed ? '1' : '0',
    );
  }, [timelineCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      TRACE_NESTING_MODE_STORAGE_KEY,
      traceNestingMode,
    );
  }, [traceNestingMode]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scopedRootSpan = traceScopeSpanId
    ? (spans.find((span) => span.id === traceScopeSpanId) ?? null)
    : null;
  const scopedSpans = useMemo(() => {
    if (traceScopeSpanId === null || scopedRootSpan === null) return spans;
    const subtreeIds = getSubtreeSpanIds(spans, traceScopeSpanId);
    return spans.filter((span) => subtreeIds.has(span.id));
  }, [scopedRootSpan, spans, traceScopeSpanId]);

  const isNarrow = containerWidth > 0 && containerWidth < NARROW_BREAKPOINT;
  const spanKindOptions = useMemo(
    () => [...new Set(scopedSpans.map((span) => span.kind))].sort(),
    [scopedSpans],
  );
  const spanNameFilterRegex = useMemo(
    () => buildSpanNameWildcardRegex(spanNameFilterPattern),
    [spanNameFilterPattern],
  );
  const hasKindFilter =
    spanKindFilterMode !== 'all' && selectedSpanKinds.size > 0;
  const hasSpanNameFilter = spanNameFilterRegex !== null;
  const filteredSpanIds = useMemo(
    () =>
      new Set(
        scopedSpans
          .filter((span) => {
            return (
              spanMatchesKindFilter(
                span,
                spanKindFilterMode,
                selectedSpanKinds,
              ) &&
              (spanNameFilterRegex?.test(span.name) ?? true)
            );
          })
          .map((span) => span.id),
      ),
    [
      scopedSpans,
      selectedSpanKinds,
      spanKindFilterMode,
      spanNameFilterRegex,
    ],
  );
  const filteredSpans = useMemo(
    () => scopedSpans.filter((span) => filteredSpanIds.has(span.id)),
    [filteredSpanIds, scopedSpans],
  );
  const displayedSpans =
    filteredSpanVisibility === 'faded' ? scopedSpans : filteredSpans;
  const displayMetricsSpans =
    filteredSpanVisibility === 'faded' ? scopedSpans : filteredSpans;

  const metrics = useMemo(
    () => computeTraceMetrics(displayMetricsSpans),
    [displayMetricsSpans],
  );

  const filteredLabel =
    hasKindFilter || hasSpanNameFilter
      ? `${String(filteredSpans.length)} of ${String(scopedSpans.length)} spans`
      : 'All spans';
  const showSpanNameFilter = spanNameFilterVisible || hasSpanNameFilter;
  const showFilterOptions = spanKindFilterMode !== 'all' || showSpanNameFilter;

  const childrenByParent = useMemo(
    () => buildTraceChildrenByParent(displayedSpans, traceNestingMode),
    [displayedSpans, traceNestingMode],
  );

  const visibleRows = useMemo(
    () => flattenVisibleRows(childrenByParent, collapsed),
    [childrenByParent, collapsed],
  );
  const labelColumnWidth = useMemo(() => {
    let maxWidth = LABEL_COLUMN_MIN_WIDTH;
    for (const row of visibleRows) {
      maxWidth = Math.max(
        maxWidth,
        estimateTraceLabelWidth({ depth: row.depth, span: row.span }),
      );
    }
    return maxWidth;
  }, [visibleRows]);
  const timelineInnerRightPadding = useMemo(() => {
    let maxDurationLabelWidth = 0;
    for (const row of visibleRows) {
      if (row.span.kind === 'checkpoint') continue;
      const bar = computeSpanBar(row.span, metrics);
      maxDurationLabelWidth = Math.max(
        maxDurationLabelWidth,
        estimateDurationLabelWidth(formatSpanBarDuration(bar)),
      );
    }
    return Math.max(
      TIMELINE_DURATION_LABEL_MIN_RIGHT_PADDING,
      maxDurationLabelWidth +
        TIMELINE_DURATION_LABEL_GAP +
        TIMELINE_DURATION_LABEL_END_PADDING,
    );
  }, [metrics, visibleRows]);
  const timelineGridTemplateColumns = timelineCollapsed
    ? '1fr'
    : `${String(labelColumnWidth)}px minmax(${String(
        TIMELINE_COLUMN_MIN_WIDTH,
      )}px, 1fr)`;
  const timelineInnerMinWidth = timelineCollapsed
    ? labelColumnWidth
    : labelColumnWidth + TIMELINE_COLUMN_MIN_WIDTH + timelineInnerRightPadding;

  const selectedSpan = selectedSpanId
    ? (displayedSpans.find((s) => s.id === selectedSpanId) ?? null)
    : null;

  useEffect(() => {
    if (!selectedSpanId || selectedSpan) return;
    updateSelectedSpanId(null);
  }, [selectedSpan, selectedSpanId]);

  useEffect(() => {
    if (!selectedSpanId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') updateSelectedSpanId(null);
    }
    function onClickAway(event: MouseEvent) {
      const detailElement = detailRef.current;
      const rootElement = rootRef.current;
      const clickedSpanRow =
        event.target instanceof Element &&
        rootElement?.contains(event.target) === true &&
        event.target.closest('[data-span-row]') !== null;
      if (
        detailElement &&
        event.target instanceof Node &&
        !clickedSpanRow &&
        !detailElement.contains(event.target)
      ) {
        updateSelectedSpanId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickAway);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickAway);
    };
  }, [selectedSpanId]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelect(id: string) {
    updateSelectedSpanId(selectedSpanId === id ? null : id);
  }

  function toggleSelectedSpanKind(kind: string) {
    setSelectedSpanKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const tickLabels = buildRulerTicks(metrics.totalMs);

  return (
    <Root ref={rootRef}>
      <TimelinePane>
        {scopedRootSpan !== null ? (
          <ScopeBanner>
            <ScopeLabel>
              Showing trace for
              <ScopeName>{scopedRootSpan.name}</ScopeName>
            </ScopeLabel>
            <ClearScopeButton
              type="button"
              onClick={clearTraceScope}
            >
              Show all spans
            </ClearScopeButton>
          </ScopeBanner>
        ) : null}
        <TraceFilterToolbar
          filteredLabel={filteredLabel}
          filteredSpanVisibility={filteredSpanVisibility}
          onFilteredSpanVisibilityChange={setFilteredSpanVisibility}
          onSpanKindFilterModeChange={setSpanKindFilterMode}
          onSpanKindToggle={toggleSelectedSpanKind}
          onSpanNameFilterPatternChange={setSpanNameFilterPattern}
          onSpanNameFilterVisibleChange={setSpanNameFilterVisible}
          selectedSpanKinds={selectedSpanKinds}
          showFilterOptions={showFilterOptions}
          showSpanNameFilter={showSpanNameFilter}
          spanKindFilterMode={spanKindFilterMode}
          spanKindOptions={spanKindOptions}
          spanNameFilterPattern={spanNameFilterPattern}
        />
        <TimelineScroll>
          <TimelineInner
            timelineCollapsed={timelineCollapsed}
            style={{
              minWidth: timelineInnerMinWidth,
              paddingRight: timelineCollapsed ? 0 : timelineInnerRightPadding,
            }}
          >
            <RulerRow
              timelineCollapsed={timelineCollapsed}
              style={{ gridTemplateColumns: timelineGridTemplateColumns }}
            >
              <RulerLabelInline>
                <RulerLabelText>Span</RulerLabelText>
                <RulerControls>
                  <NestingModeControl>
                    <Tooltip content="Recorded parent hierarchy">
                      <NestingModeButton
                        type="button"
                        active={traceNestingMode === 'parent'}
                        onClick={() => setTraceNestingMode('parent')}
                        aria-label="Use recorded parent hierarchy"
                      >
                        <GitFork />
                      </NestingModeButton>
                    </Tooltip>
                    <Tooltip content="Timeline nesting">
                      <NestingModeButton
                        type="button"
                        active={traceNestingMode === 'timeline'}
                        onClick={() => setTraceNestingMode('timeline')}
                        aria-label="Use timeline nesting"
                      >
                        <Clock3 />
                      </NestingModeButton>
                    </Tooltip>
                  </NestingModeControl>
                  <Tooltip
                    content={
                      timelineCollapsed ? 'Show timeline' : 'Hide timeline'
                    }
                  >
                    <TimelineToggle
                      type="button"
                      onClick={() => setTimelineCollapsed((v) => !v)}
                      aria-label={
                        timelineCollapsed ? 'Show timeline' : 'Hide timeline'
                      }
                    >
                      {timelineCollapsed ? (
                        <PanelRightOpen />
                      ) : (
                        <PanelRightClose />
                      )}
                    </TimelineToggle>
                  </Tooltip>
                </RulerControls>
              </RulerLabelInline>
              {!timelineCollapsed ? (
                <RulerTimelineCell>
                  {tickLabels.map((tick) => {
                    const anchor =
                      tick.pct === 0
                        ? '0%'
                        : tick.pct === 100
                          ? '-100%'
                          : '-50%';
                    return (
                      <RulerTick
                        key={tick.pct}
                        style={{
                          left: `${tick.pct}%`,
                          transform: `translate(${anchor}, -50%)`,
                        }}
                      >
                        {tick.label}
                      </RulerTick>
                    );
                  })}
                </RulerTimelineCell>
              ) : null}
            </RulerRow>
            <Rows>
              {visibleRows.length === 0 ? (
                <Empty>
                  {spans.length === 0
                    ? 'No spans recorded for this case.'
                    : 'No spans match this filter.'}
                </Empty>
              ) : null}
              {visibleRows.map(({ span, depth, hasChildren }) => {
                const bar = computeSpanBar(span, metrics);
                const isCollapsed = collapsed.has(span.id);
                const isCheckpoint = span.kind === 'checkpoint';
                const kindStyle = getTraceKindStyle(
                  getTraceKindColors(span.kind),
                );
                const treeAttributeItems = getTraceAttributeItems(
                  span,
                  scopedSpans,
                  traceDisplay,
                  'tree',
                );
                const durationLeft = bar.leftPct + bar.widthPct;
                const durationText = formatSpanBarDuration(bar);
                const durationRemainingPct =
                  Math.round(Math.max(0, 100 - durationLeft) * 100) / 100;
                const durationLabelMaxWidth = `calc(${String(
                  durationRemainingPct,
                )}% + ${String(
                  timelineInnerRightPadding - TIMELINE_DURATION_LABEL_GAP,
                )}px)`;
                const checkpointPreview = isCheckpoint
                  ? formatCheckpointPreview(span.attributes?.value)
                  : null;
                const hasError = span.status === 'error';
                const outputDiagnosticMatch =
                  getSpanOutputDiagnosticMatch(span);
                const hasSpanWarning =
                  span.warning !== undefined ||
                  (span.warnings?.length ?? 0) > 0;
                const hasWarning =
                  !hasError &&
                  (hasSpanWarning || outputDiagnosticMatch !== undefined);
                const diagnosticTooltip = hasError
                  ? formatSpanDiagnosticTooltip(span, 'error')
                  : hasWarning
                    ? hasSpanWarning || outputDiagnosticMatch === undefined
                      ? formatSpanDiagnosticTooltip(span, 'warning')
                      : formatSpanOutputDiagnosticTooltip(outputDiagnosticMatch)
                    : undefined;
                const diagnosticLabel = hasError
                  ? 'Errored span'
                  : 'Warning span';
                return (
                  <Row
                    key={span.id}
                    data-span-row="true"
                    active={selectedSpanId === span.id}
                    timelineCollapsed={timelineCollapsed}
                    isFaded={!filteredSpanIds.has(span.id)}
                    style={{ gridTemplateColumns: timelineGridTemplateColumns }}
                    onClick={() => handleSelect(span.id)}
                  >
                    <LabelCell style={{ paddingLeft: depth * 14 + 8 }}>
                      {hasChildren ? (
                        <ToggleButton
                          type="button"
                          open={!isCollapsed}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(span.id);
                          }}
                          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                        >
                          <ChevronRight />
                        </ToggleButton>
                      ) : (
                        <Spacer />
                      )}
                      <KindBadge style={kindStyle}>{span.kind}</KindBadge>
                      {hasError || hasWarning ? (
                        <Tooltip
                          content={diagnosticTooltip}
                          placement="top"
                        >
                          <SpanStatusIcon
                            isError={hasError}
                            isWarning={hasWarning}
                            aria-label={diagnosticLabel}
                          >
                            {hasError ? <CircleAlert /> : <TriangleAlert />}
                          </SpanStatusIcon>
                        </Tooltip>
                      ) : null}
                      <Tooltip
                        content={span.name}
                        placement="top"
                      >
                        <SpanName
                          isError={hasError}
                          isWarning={hasWarning}
                        >
                          {span.name}
                        </SpanName>
                      </Tooltip>
                      {checkpointPreview !== null ? (
                        <Tooltip content={checkpointPreview}>
                          <CheckpointPreview>
                            {checkpointPreview}
                          </CheckpointPreview>
                        </Tooltip>
                      ) : null}
                      <TraceCacheBadge span={span} />
                      {treeAttributeItems.map((item) => (
                        <TreeAttributeLabel key={item.config.path}>
                          {formatTraceAttributeValue(item.value, item.config)}
                        </TreeAttributeLabel>
                      ))}
                    </LabelCell>
                    {!timelineCollapsed ? (
                      <TimelineCell>
                        {isCheckpoint ? (
                          <CheckpointMarker
                            style={getCheckpointMarkerStyle(kindStyle, bar)}
                          />
                        ) : (
                          <>
                            <WaterfallBar
                              isRunning={bar.isRunning}
                              isError={span.status === 'error'}
                              style={getTraceKindBarStyle(kindStyle, bar)}
                            />
                            <Tooltip
                              content={durationText}
                              placement="top"
                            >
                              <BarDurationLabel
                                style={{
                                  left: `calc(${durationLeft}% + ${String(
                                    TIMELINE_DURATION_LABEL_GAP,
                                  )}px)`,
                                  maxWidth: durationLabelMaxWidth,
                                }}
                              >
                                {durationText}
                              </BarDurationLabel>
                            </Tooltip>
                          </>
                        )}
                      </TimelineCell>
                    ) : null}
                  </Row>
                );
              })}
            </Rows>
          </TimelineInner>
        </TimelineScroll>
      </TimelinePane>

      {!isNarrow && selectedSpan ? (
        <DetailPane ref={detailRef}>
          <SpanDetail
            span={selectedSpan}
            spans={scopedSpans}
            traceDisplay={traceDisplay}
          />
        </DetailPane>
      ) : null}

      {isNarrow && selectedSpan ? (
        <DetailOverlay ref={detailRef}>
          <OverlayHeader>
            <OverlayLabel>Span detail</OverlayLabel>
            <CloseButton
              type="button"
              onClick={() => updateSelectedSpanId(null)}
              aria-label="Close span detail"
            >
              <X />
            </CloseButton>
          </OverlayHeader>
          <OverlayBody>
            <SpanDetail
              span={selectedSpan}
              spans={scopedSpans}
              traceDisplay={traceDisplay}
            />
          </OverlayBody>
        </DetailOverlay>
      ) : null}
    </Root>
  );

  function updateSelectedSpanId(id: string | null): void {
    updateSearchParams((nextSearchParams) => {
      nextSearchParams.delete(spanSearchParamKey);
      if (id) nextSearchParams.set(spanSearchParamKey, id);
    });
  }

  function clearTraceScope(): void {
    updateSearchParams((nextSearchParams) => {
      nextSearchParams.delete(traceScopeSearchParamKey);
    });
  }
}
