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
  TIMELINE_INNER_RIGHT_PADDING,
  type TraceNestingMode,
} from '#src/components/TraceTree.helpers';
import { TraceCacheBadge } from '#src/components/TraceTreeCacheBadge';
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

const TimelineToolbar = styled.div<{ hasFilterOptions: boolean }>`
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 24px;
  column-gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  flex-shrink: 0;

  &.hasFilterOptions {
    grid-template-rows: 24px 24px;
    row-gap: 6px;
  }
`;

const TimelineCount = styled.span`
  ${monoFont};
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${colors.textDim.var};
  white-space: nowrap;
  grid-column: 1;
  grid-row: 1;
`;

const FilterControls = styled.div`
  ${inline({ justify: 'right', align: 'center' })}
  min-width: 0;
  grid-column: 2;
  grid-row: 1;
`;

const FilterOptionsRow = styled.div`
  ${inline({ justify: 'right', align: 'center', gap: 8 })}
  min-width: 0;
  height: 24px;
  grid-column: 1 / -1;
  grid-row: 2;
`;

const SegmentedControl = styled.div`
  ${inline({ align: 'center' })}
  border: 1px solid ${colors.border.var};
  border-radius: 5px;
  overflow: hidden;
  background: ${colors.bg.var};
  flex-shrink: 0;
`;

const SegmentButton = styled.button<{ active: boolean }>`
  ${transition({ property: 'background, color' })}
  height: 24px;
  padding: 0 9px;
  border: none;
  border-right: 1px solid ${colors.border.var};
  background: transparent;
  color: ${colors.textDim.var};
  font-size: 11.5px;
  font-weight: 500;
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
`;

const KindFilterList = styled.div`
  ${inline({ align: 'center', gap: 4 })}
  justify-content: flex-end;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const KindFilterOption = styled.label<{ selected: boolean }>`
  ${inline({ align: 'center', gap: 5 })}
  height: 24px;
  padding: 0 8px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  color: ${colors.textMuted.var};
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;

  &:hover {
    border-color: ${colors.borderStrong.var};
    color: ${colors.text.var};
  }

  &.selected {
    border-color: ${colors.accent.alpha(0.45)};
    background: ${colors.accent.alpha(0.1)};
    color: ${colors.text.var};
  }

  & > input {
    width: 12px;
    height: 12px;
    margin: 0;
    accent-color: ${colors.accent.var};
  }
`;

const VisibilityToggleLabel = styled.label`
  ${inline({ align: 'center', gap: 6 })}
  height: 24px;
  padding: 0 8px;
  color: ${colors.textMuted.var};
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;

  &:hover {
    color: ${colors.text.var};
  }

  & > input {
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: ${colors.accent.var};
  }
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
  padding-right: ${TIMELINE_INNER_RIGHT_PADDING}px;

  &.timelineCollapsed {
    min-width: 0;
    padding-right: 0;
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
  position: absolute;
  top: 5px;
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  color: ${colors.textMuted.var};
  white-space: nowrap;
  pointer-events: none;

  &.inside {
    color: ${colors.white.var};
    font-weight: 500;
    letter-spacing: 0.02em;
    background: ${colors.black.alpha(0.2)};
    padding: 0 5px;
    line-height: 12px;
    top: 7px;
    height: 12px;
    margin-right: -4px;
    border-radius: 3px;
  }
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

type TraceTreeProps = {
  spans: EvalTraceSpan[];
  traceDisplay: TraceDisplayConfig;
};

type SpanKindFilterMode = 'all' | 'only' | 'hide';
type FilteredSpanVisibility = 'hidden' | 'faded';

const TIMELINE_COLLAPSED_STORAGE_KEY = 'agent-evals.trace-timeline-collapsed';
const TRACE_NESTING_MODE_STORAGE_KEY = 'agent-evals.trace-nesting-mode';
const SPAN_SEARCH_PARAM_KEY = 'span';

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

export function TraceTree({ spans, traceDisplay }: TraceTreeProps) {
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
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const selectedSpanId = searchParams.get(SPAN_SEARCH_PARAM_KEY);

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

  const isNarrow = containerWidth > 0 && containerWidth < NARROW_BREAKPOINT;
  const spanKindOptions = useMemo(
    () => [...new Set(spans.map((span) => span.kind))].sort(),
    [spans],
  );
  const filteredSpanIds = useMemo(
    () =>
      new Set(
        spans
          .filter((span) =>
            spanMatchesKindFilter(span, spanKindFilterMode, selectedSpanKinds),
          )
          .map((span) => span.id),
      ),
    [selectedSpanKinds, spanKindFilterMode, spans],
  );
  const filteredSpans = useMemo(
    () => spans.filter((span) => filteredSpanIds.has(span.id)),
    [filteredSpanIds, spans],
  );
  const displayedSpans =
    filteredSpanVisibility === 'faded' ? spans : filteredSpans;
  const displayMetricsSpans =
    filteredSpanVisibility === 'faded' ? spans : filteredSpans;

  const metrics = useMemo(
    () => computeTraceMetrics(displayMetricsSpans),
    [displayMetricsSpans],
  );

  const filteredLabel =
    spanKindFilterMode === 'all' || selectedSpanKinds.size === 0
      ? 'All spans'
      : `${String(filteredSpans.length)} of ${String(spans.length)} spans`;
  const showFilterOptions = spanKindFilterMode !== 'all';

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
  const timelineGridTemplateColumns = timelineCollapsed
    ? '1fr'
    : `${String(labelColumnWidth)}px minmax(${String(
        TIMELINE_COLUMN_MIN_WIDTH,
      )}px, 1fr)`;
  const timelineInnerMinWidth = timelineCollapsed
    ? labelColumnWidth
    : labelColumnWidth + TIMELINE_COLUMN_MIN_WIDTH;

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
      const clickedSpanRow =
        event.target instanceof Element &&
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
        <TimelineToolbar hasFilterOptions={showFilterOptions}>
          <TimelineCount>{filteredLabel}</TimelineCount>
          <FilterControls>
            <SegmentedControl>
              <SegmentButton
                type="button"
                active={spanKindFilterMode === 'all'}
                onClick={() => setSpanKindFilterMode('all')}
                aria-pressed={spanKindFilterMode === 'all'}
              >
                All
              </SegmentButton>
              <SegmentButton
                type="button"
                active={spanKindFilterMode === 'only'}
                onClick={() => setSpanKindFilterMode('only')}
                aria-pressed={spanKindFilterMode === 'only'}
              >
                Only
              </SegmentButton>
              <SegmentButton
                type="button"
                active={spanKindFilterMode === 'hide'}
                onClick={() => setSpanKindFilterMode('hide')}
                aria-pressed={spanKindFilterMode === 'hide'}
              >
                Hide
              </SegmentButton>
            </SegmentedControl>
          </FilterControls>
          {showFilterOptions ? (
            <FilterOptionsRow>
              <VisibilityToggleLabel>
                <input
                  type="checkbox"
                  checked={filteredSpanVisibility === 'faded'}
                  onChange={(event) => {
                    setFilteredSpanVisibility(
                      event.currentTarget.checked ? 'faded' : 'hidden',
                    );
                  }}
                />
                Fade filtered
              </VisibilityToggleLabel>
              <KindFilterList>
                {spanKindOptions.map((kind) => (
                  <KindFilterOption
                    key={kind}
                    selected={selectedSpanKinds.has(kind)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSpanKinds.has(kind)}
                      onChange={() => toggleSelectedSpanKind(kind)}
                    />
                    {kind}
                  </KindFilterOption>
                ))}
              </KindFilterList>
            </FilterOptionsRow>
          ) : null}
        </TimelineToolbar>
        <TimelineScroll>
          <TimelineInner
            timelineCollapsed={timelineCollapsed}
            style={{ minWidth: timelineInnerMinWidth }}
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
                  spans,
                  traceDisplay,
                  'tree',
                );
                const durationLeft = bar.leftPct + bar.widthPct;
                const labelInside = durationLeft > 88;
                const labelRightPct = Math.max(0, 100 - durationLeft);
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
                            <BarDurationLabel
                              className={labelInside ? 'inside' : undefined}
                              style={
                                labelInside
                                  ? { right: `calc(${labelRightPct}% + 4px)` }
                                  : { left: `calc(${durationLeft}% + 6px)` }
                              }
                            >
                              {formatSpanDuration(bar.durationMs)}
                              {bar.isRunning ? '…' : ''}
                            </BarDurationLabel>
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
            spans={spans}
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
              spans={spans}
              traceDisplay={traceDisplay}
            />
          </OverlayBody>
        </DetailOverlay>
      ) : null}
    </Root>
  );

  function updateSelectedSpanId(id: string | null): void {
    updateSearchParams((nextSearchParams) => {
      nextSearchParams.delete(SPAN_SEARCH_PARAM_KEY);
      if (id) nextSearchParams.set(SPAN_SEARCH_PARAM_KEY, id);
    });
  }
}
