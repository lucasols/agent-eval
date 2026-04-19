import { useState } from 'react';
import type { EvalTraceSpan, TraceDisplayConfig } from '@agent-evals/shared';
import { styled } from 'vindur';
import { ChevronRight } from 'lucide-react';
import { colors } from '#src/style/colors';
import { inline, monoFont, transition } from '#src/style/helpers';
import {
  formatTraceAttributeValue,
  getTraceAttributeItems,
} from '#src/utils/traceAttributes';
import { SpanDetail } from './SpanDetail.tsx';

const Root = styled.div`
  ${inline({ gap: 12 })}
  height: 100%;
  align-items: stretch;
`;

const TreePane = styled.div`
  flex: 1;
  min-width: 0;
  overflow: auto;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.surface.var};
  padding: 4px 0;
`;

const DetailPane = styled.div`
  flex: 1;
  min-width: 0;
  overflow: auto;
`;

const SpanRow = styled.div<{ active: boolean }>`
  ${inline({ gap: 6, align: 'center' })}
  ${transition({ property: 'background, color' })}
  cursor: pointer;
  font-size: 11.5px;
  height: 24px;
  padding-right: 8px;
  border-left: 2px solid transparent;
  color: ${colors.textMuted.var};

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.surfaceActive.var};
    color: ${colors.text.var};
    border-left-color: ${colors.accent.var};
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
  ${monoFont}
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${colors.text.var};
  background: ${colors.borderStrong.var};
  flex-shrink: 0;

  &.agent {
    background: ${colors.accent.alpha(0.15)};
    color: ${colors.accent.var};
  }
  &.llm {
    background: rgba(99, 156, 255, 0.15);
    color: #9bb8ff;
  }
  &.tool {
    background: ${colors.success.alpha(0.15)};
    color: ${colors.success.var};
  }
  &.retrieval {
    background: ${colors.warning.alpha(0.15)};
    color: ${colors.warning.var};
  }
  &.scorer {
    background: rgba(236, 72, 153, 0.15);
    color: #f0a4cf;
  }
  &.checkpoint {
    background: rgba(99, 102, 241, 0.15);
    color: #b1b3ff;
  }
  &.evalKind {
    background: ${colors.borderStrong.var};
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
  ${monoFont}
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
  ${monoFont}
  color: ${colors.error.var};
  font-size: 10px;
  flex-shrink: 0;
`;

const DurationLabel = styled.span`
  ${monoFont}
  color: ${colors.textDim.var};
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

const TreeAttributeLabel = styled.span`
  ${monoFont}
  font-size: 9.5px;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  color: ${colors.textDim.var};
`;

type TraceTreeProps = {
  spans: EvalTraceSpan[];
  traceDisplay: TraceDisplayConfig;
};

export function TraceTree({ spans, traceDisplay }: TraceTreeProps) {
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const rootSpans = spans.filter((s) => s.parentId === null);
  const selectedSpan =
    selectedSpanId ?
      (spans.find((s) => s.id === selectedSpanId) ?? null)
    : null;

  return (
    <Root>
      <TreePane>
        {rootSpans.map((span) => (
          <SpanNode
            key={span.id}
            span={span}
            spans={spans}
            depth={0}
            traceDisplay={traceDisplay}
            selectedSpanId={selectedSpanId}
            onSelect={setSelectedSpanId}
          />
        ))}
      </TreePane>
      {selectedSpan ?
        <DetailPane>
          <SpanDetail
            span={selectedSpan}
            spans={spans}
            traceDisplay={traceDisplay}
          />
        </DetailPane>
      : null}
    </Root>
  );
}

function SpanNode({
  span,
  spans,
  depth,
  traceDisplay,
  selectedSpanId,
  onSelect,
}: {
  span: EvalTraceSpan;
  spans: EvalTraceSpan[];
  depth: number;
  traceDisplay: TraceDisplayConfig;
  selectedSpanId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = spans.filter((s) => s.parentId === span.id);
  const hasChildren = children.length > 0;
  const treeAttributeItems = getTraceAttributeItems(
    span,
    spans,
    traceDisplay,
    'tree',
  );

  const durationMs =
    span.startedAt && span.endedAt ?
      new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()
    : null;

  return (
    <div>
      <SpanRow
        onClick={() => onSelect(span.id)}
        active={selectedSpanId === span.id}
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {hasChildren ?
          <ToggleButton
            type="button"
            open={expanded}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <ChevronRight />
          </ToggleButton>
        : <Spacer />}
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
        {span.status === 'error' ?
          <ErrorLabel>err</ErrorLabel>
        : null}
        {durationMs !== null ?
          <DurationLabel>{formatSpanDuration(durationMs)}</DurationLabel>
        : null}
        {treeAttributeItems.map((item) => (
          <TreeAttributeLabel key={item.config.path}>
            {formatTraceAttributeValue(item.value, item.config.format)}
          </TreeAttributeLabel>
        ))}
      </SpanRow>
      {expanded && hasChildren ?
        children.map((child) => (
          <SpanNode
            key={child.id}
            span={child}
            spans={spans}
            depth={depth + 1}
            traceDisplay={traceDisplay}
            selectedSpanId={selectedSpanId}
            onSelect={onSelect}
          />
        ))
      : null}
    </div>
  );
}

function formatSpanDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderCacheBadge(span: EvalTraceSpan) {
  const status = span.attributes?.['cache.status'];
  if (
    status !== 'hit'
    && status !== 'miss'
    && status !== 'refresh'
    && status !== 'bypass'
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
