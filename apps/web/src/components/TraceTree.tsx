import { useState } from 'react';
import type { EvalTraceSpan } from '@agent-evals/shared';
import { styled, css } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, monoFont } from '#src/style/helpers';
import { SpanDetail } from './SpanDetail.tsx';

const Root = styled.div`
  ${inline({ gap: 16 })}
  height: 100%;
`;

const TreePane = styled.div`
  flex: 1;
  overflow: auto;
`;

const DetailPane = styled.div`
  flex: 1;
  overflow: auto;
`;

const SpanRow = styled.div`
  ${inline({ gap: 6 })}
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: 12px;
`;

const ToggleButton = styled.button`
  background: none;
  border: none;
  color: ${colors.textMuted.var};
  font-size: 10px;
  width: 16px;
  padding: 0;
`;

const Spacer = styled.span`
  width: 16px;
`;

const KindBadge = styled.span`
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  color: ${colors.white.var};
`;

const SpanName = styled.span`
  font-weight: 500;
`;

const ErrorLabel = styled.span`
  color: ${colors.error.var};
  font-size: 10px;
`;

const DurationLabel = styled.span`
  color: ${colors.textMuted.var};
  font-size: 11px;
  margin-left: auto;
`;

const CostLabel = styled.span`
  color: ${colors.cost.var};
  font-size: 11px;
  ${monoFont}
`;

const CacheBadge = styled.span`
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
`;

const cacheHitStyle = css`
  background: rgba(74, 222, 128, 0.2);
  color: ${colors.success.var};
`;

const cacheMissStyle = css`
  background: rgba(248, 113, 113, 0.2);
  color: ${colors.error.var};
`;

type TraceTreeProps = {
  spans: EvalTraceSpan[];
};

export function TraceTree({ spans }: TraceTreeProps) {
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const rootSpans = spans.filter((s) => s.parentId === null);
  const selectedSpan = selectedSpanId
    ? spans.find((s) => s.id === selectedSpanId) ?? null
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
            selectedSpanId={selectedSpanId}
            onSelect={setSelectedSpanId}
          />
        ))}
      </TreePane>
      {selectedSpan ? (
        <DetailPane>
          <SpanDetail span={selectedSpan} />
        </DetailPane>
      ) : null}
    </Root>
  );
}

const kindColors: Record<string, string> = {
  agent: '#8b5cf6',
  llm: '#3b82f6',
  tool: '#10b981',
  retrieval: '#f59e0b',
  scorer: '#ec4899',
  checkpoint: '#6366f1',
  eval: '#64748b',
  custom: '#94a3b8',
};

function SpanNode({
  span,
  spans,
  depth,
  selectedSpanId,
  onSelect,
}: {
  span: EvalTraceSpan;
  spans: EvalTraceSpan[];
  depth: number;
  selectedSpanId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = spans.filter((s) => s.parentId === span.id);
  const hasChildren = children.length > 0;

  const durationMs =
    span.startedAt && span.endedAt
      ? new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()
      : null;

  const rowStyle = {
    paddingLeft: depth * 20 + 8,
    background:
      selectedSpanId === span.id ? colors.surfaceHover.var : 'transparent',
  };

  const kindBadgeStyle = {
    background: kindColors[span.kind] ?? '#64748b',
  };

  return (
    <div>
      <SpanRow
        onClick={() => onSelect(span.id)}
        style={rowStyle}
      >
        {hasChildren ? (
          <ToggleButton
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? '\u25bc' : '\u25b6'}
          </ToggleButton>
        ) : (
          <Spacer />
        )}
        <KindBadge style={kindBadgeStyle}>
          {span.kind}
        </KindBadge>
        <SpanName>{span.name}</SpanName>
        {span.status === 'error' ? (
          <ErrorLabel>ERR</ErrorLabel>
        ) : null}
        {durationMs !== null ? (
          <DurationLabel>
            {durationMs}ms
          </DurationLabel>
        ) : null}
        {span.costUsd !== null && span.costUsd !== undefined ? (
          <CostLabel>
            ${span.costUsd.toFixed(4)}
          </CostLabel>
        ) : null}
        {span.cache ? (
          <CacheBadge className={span.cache.status === 'hit' ? cacheHitStyle : cacheMissStyle}>
            {span.cache.status}
          </CacheBadge>
        ) : null}
      </SpanRow>
      {expanded && hasChildren
        ? children.map((child) => (
            <SpanNode
              key={child.id}
              span={child}
              spans={spans}
              depth={depth + 1}
              selectedSpanId={selectedSpanId}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}
