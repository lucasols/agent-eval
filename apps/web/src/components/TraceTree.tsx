import type { EvalTraceSpan, TraceDisplayConfig } from '@agent-evals/shared';
import { ChevronRight, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { styled } from 'vindur';
import {
  updateSearchParams,
  useSearchParams,
} from '#src/hooks/useSearchParams';
import { colors } from '#src/style/colors';
import { inline, monoFont, transition } from '#src/style/helpers';
import {
  formatTraceAttributeValue,
  getTraceAttributeItems,
} from '#src/utils/traceAttributes';
import { SpanDetail } from './SpanDetail.tsx';

const NARROW_BREAKPOINT = 720;

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

const Row = styled.div<{ active: boolean; timelineCollapsed: boolean }>`
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
`;

const LabelCell = styled.div`
  ${inline({ gap: 7, align: 'center' })}
  min-width: 0;
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

const WaterfallBar = styled.div<{
  agent: boolean;
  llm: boolean;
  tool: boolean;
  retrieval: boolean;
  scorer: boolean;
  checkpoint: boolean;
  evalKind: boolean;
  isRunning: boolean;
  isError: boolean;
}>`
  position: absolute;
  top: 7px;
  height: 12px;
  min-width: 2px;
  border-radius: 3px;
  background: ${colors.borderStrong.var};
  border: 1px solid transparent;

  &.agent {
    background: rgba(167, 139, 250, 0.55);
  }
  &.llm {
    background: rgba(103, 232, 249, 0.7);
  }
  &.tool {
    background: rgba(240, 171, 252, 0.6);
  }
  &.retrieval {
    background: ${colors.warning.alpha(0.55)};
  }
  &.scorer {
    background: rgba(236, 72, 153, 0.5);
  }
  &.checkpoint {
    background: rgba(99, 102, 241, 0.5);
  }
  &.evalKind {
    background: ${colors.surfaceActive.var};
  }

  &.isRunning {
    background: repeating-linear-gradient(
      45deg,
      ${colors.accent.alpha(0.4)} 0,
      ${colors.accent.alpha(0.4)} 6px,
      ${colors.accent.alpha(0.15)} 6px,
      ${colors.accent.alpha(0.15)} 12px
    );
  }

  &.isError {
    border-color: ${colors.error.var};
  }
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

const KindBadge = styled.span<{
  agent: boolean;
  llm: boolean;
  tool: boolean;
  retrieval: boolean;
  scorer: boolean;
  checkpoint: boolean;
  evalKind: boolean;
}>`
  ${monoFont};
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};
  flex-shrink: 0;

  &.agent {
    background: rgba(167, 139, 250, 0.14);
    color: #7c3aed;
  }
  &.llm {
    background: rgba(103, 232, 249, 0.18);
    color: ${colors.accentDim.var};
  }
  &.tool {
    background: rgba(240, 171, 252, 0.18);
    color: #a21caf;
  }
  &.retrieval {
    background: ${colors.warning.alpha(0.12)};
    color: ${colors.warning.var};
  }
  &.scorer {
    background: rgba(236, 72, 153, 0.15);
    color: #be185d;
  }
  &.checkpoint {
    background: rgba(99, 102, 241, 0.15);
    color: #4338ca;
  }
  &.evalKind {
    background: ${colors.surface.var};
    color: ${colors.textMuted.var};
  }
`;

const SpanName = styled.span`
  font-weight: 500;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
`;

const CacheBadge = styled.span<{
  hit: boolean;
  miss: boolean;
  refresh: boolean;
  bypass: boolean;
}>`
  ${monoFont};
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
  background: ${colors.borderStrong.var};
  color: ${colors.textMuted.var};

  &.hit {
    background: ${colors.success.alpha(0.15)};
    color: ${colors.success.var};
  }
  &.miss {
    background: ${colors.warning.alpha(0.15)};
    color: ${colors.warning.var};
  }
  &.refresh {
    background: ${colors.accent.alpha(0.15)};
    color: ${colors.accent.var};
  }
  &.bypass {
    background: ${colors.borderStrong.var};
    color: ${colors.textMuted.var};
  }
`;

const ErrorLabel = styled.span`
  ${monoFont};
  color: ${colors.error.var};
  font-size: 10px;
  flex-shrink: 0;
`;

const TreeAttributeLabel = styled.span`
  ${monoFont};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  color: ${colors.textDim.var};
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

type VisibleRow = { span: EvalTraceSpan; depth: number; hasChildren: boolean };

type TraceMetrics = {
  startMs: number;
  totalMs: number;
  endMs: number;
  nowMs: number;
};

type SpanBar = {
  leftPct: number;
  widthPct: number;
  durationMs: number;
  isRunning: boolean;
};

const TIMELINE_COLLAPSED_STORAGE_KEY = 'agent-evals.trace-timeline-collapsed';
const SPAN_SEARCH_PARAM_KEY = 'span';

function readTimelineCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(TIMELINE_COLLAPSED_STORAGE_KEY) === '1';
}

export function TraceTree({ spans, traceDisplay }: TraceTreeProps) {
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [timelineCollapsed, setTimelineCollapsed] = useState<boolean>(
    readTimelineCollapsed,
  );
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSpanId = searchParams.get(SPAN_SEARCH_PARAM_KEY);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      TIMELINE_COLLAPSED_STORAGE_KEY,
      timelineCollapsed ? '1' : '0',
    );
  }, [timelineCollapsed]);

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

  const metrics = useMemo(() => computeTraceMetrics(spans), [spans]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, EvalTraceSpan[]>();
    for (const span of spans) {
      const list = map.get(span.parentId);
      if (list) list.push(span);
      else map.set(span.parentId, [span]);
    }
    const sortByStart = (a: EvalTraceSpan, b: EvalTraceSpan) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt);
    for (const list of map.values()) list.sort(sortByStart);
    return map;
  }, [spans]);

  const visibleRows = useMemo(
    () => flattenVisibleRows(childrenByParent, collapsed),
    [childrenByParent, collapsed],
  );

  const selectedSpan = selectedSpanId
    ? (spans.find((s) => s.id === selectedSpanId) ?? null)
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const tickLabels = buildRulerTicks(metrics.totalMs);

  return (
    <Root ref={rootRef}>
      <TimelinePane>
        <TimelineScroll>
          <TimelineInner timelineCollapsed={timelineCollapsed}>
            <RulerRow timelineCollapsed={timelineCollapsed}>
              <RulerLabelInline>
                <RulerLabelText>Span</RulerLabelText>
                <TimelineToggle
                  type="button"
                  onClick={() => setTimelineCollapsed((v) => !v)}
                  aria-label={
                    timelineCollapsed ? 'Show timeline' : 'Hide timeline'
                  }
                  title={timelineCollapsed ? 'Show timeline' : 'Hide timeline'}
                >
                  {timelineCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
                </TimelineToggle>
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
                <Empty>No spans recorded for this case.</Empty>
              ) : null}
              {visibleRows.map(({ span, depth, hasChildren }) => {
                const bar = computeSpanBar(span, metrics);
                const isCollapsed = collapsed.has(span.id);
                const treeAttributeItems = getTraceAttributeItems(
                  span,
                  spans,
                  traceDisplay,
                  'tree',
                );
                const durationLeft = bar.leftPct + bar.widthPct;
                const labelInside = durationLeft > 88;
                const labelRightPct = Math.max(0, 100 - durationLeft);
                return (
                  <Row
                    key={span.id}
                    active={selectedSpanId === span.id}
                    timelineCollapsed={timelineCollapsed}
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
                      <KindBadge
                        agent={span.kind === 'agent'}
                        llm={span.kind === 'llm'}
                        tool={span.kind === 'tool'}
                        retrieval={span.kind === 'retrieval'}
                        scorer={span.kind === 'scorer'}
                        checkpoint={span.kind === 'checkpoint'}
                        evalKind={span.kind === 'eval'}
                      >
                        {span.kind}
                      </KindBadge>
                      <SpanName>{span.name}</SpanName>
                      {renderCacheBadge(span)}
                      {span.status === 'error' ? (
                        <ErrorLabel>err</ErrorLabel>
                      ) : null}
                      {treeAttributeItems.map((item) => (
                        <TreeAttributeLabel key={item.config.path}>
                          {formatTraceAttributeValue(
                            item.value,
                            item.config.format,
                          )}
                        </TreeAttributeLabel>
                      ))}
                    </LabelCell>
                    {!timelineCollapsed ? (
                      <TimelineCell>
                        <WaterfallBar
                          agent={span.kind === 'agent'}
                          llm={span.kind === 'llm'}
                          tool={span.kind === 'tool'}
                          retrieval={span.kind === 'retrieval'}
                          scorer={span.kind === 'scorer'}
                          checkpoint={span.kind === 'checkpoint'}
                          evalKind={span.kind === 'eval'}
                          isRunning={bar.isRunning}
                          isError={span.status === 'error'}
                          style={{
                            left: `${bar.leftPct}%`,
                            width: `${bar.widthPct}%`,
                          }}
                        />
                        <BarDurationLabel
                          style={
                            labelInside
                              ? { right: `calc(${labelRightPct}% + 4px)` }
                              : { left: `calc(${durationLeft}% + 6px)` }
                          }
                        >
                          {formatSpanDuration(bar.durationMs)}
                          {bar.isRunning ? '…' : ''}
                        </BarDurationLabel>
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
        <DetailPane>
          <SpanDetail
            span={selectedSpan}
            spans={spans}
            traceDisplay={traceDisplay}
          />
        </DetailPane>
      ) : null}

      {isNarrow && selectedSpan ? (
        <DetailOverlay>
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

function computeTraceMetrics(spans: EvalTraceSpan[]): TraceMetrics {
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

function computeSpanBar(span: EvalTraceSpan, metrics: TraceMetrics): SpanBar {
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function flattenVisibleRows(
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

function buildRulerTicks(totalMs: number): { pct: number; label: string }[] {
  return [0, 25, 50, 75, 100].map((pct) => ({
    pct,
    label: formatSpanDuration(Math.round((totalMs * pct) / 100)),
  }));
}

function formatSpanDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderCacheBadge(span: EvalTraceSpan) {
  const status = span.attributes?.['cache.status'];
  if (
    status !== 'hit' &&
    status !== 'miss' &&
    status !== 'refresh' &&
    status !== 'bypass'
  ) {
    return null;
  }
  return (
    <CacheBadge
      hit={status === 'hit'}
      miss={status === 'miss'}
      refresh={status === 'refresh'}
      bypass={status === 'bypass'}
    >
      cache {status}
    </CacheBadge>
  );
}
