import type { LlmCallEntry, LlmCallMetricValue } from '@agent-evals/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { StatusBadge } from '#src/components/StatusBadge';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatDuration, formatNumber } from '#src/utils/formatters';

const EM_DASH = '—';

const Card = styled.div`
  ${stack({ gap: 0 })}
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: hidden;
`;

const HeaderButton = styled.button`
  ${inline({ gap: 10, align: 'center' })}
  width: 100%;
  background: transparent;
  border: none;
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
  color: ${colors.text.var};

  &:hover {
    background: ${colors.surface.var};
  }
`;

const Caret = styled.span`
  ${inline({ align: 'center' })}
  color: ${colors.textMuted.var};
  flex-shrink: 0;
`;

const HeaderName = styled.span`
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: ${colors.text.var};
  flex-shrink: 0;
`;

const HeaderMeta = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  ${monoFont};
  margin-left: auto;
  font-size: 11px;
  color: ${colors.textMuted.var};
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const ModelChip = styled.span`
  ${monoFont};
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 2px 7px;
  border-radius: 20px;
  color: ${colors.accentDim.var};
  background: ${colors.accent.alpha(0.1)};
`;

const MetricChip = styled.span`
  ${monoFont};
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  letter-spacing: 0.01em;
  padding: 2px 7px;
  border-radius: 20px;
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};
`;

const MetricChipLabel = styled.span`
  margin-right: 4px;
  color: ${colors.textDim.var};
`;

const Body = styled.div`
  ${stack({ gap: 12 })}
  padding: 12px 14px;
  border-top: 1px solid ${colors.border.var};
`;

const MetaRow = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  ${monoFont};
  flex-wrap: wrap;
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const MetricRow = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  font-size: 12px;
`;

const MetricRowLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
  min-width: 110px;
`;

const MetricRowValue = styled.span`
  ${monoFont};
  color: ${colors.text.var};
  word-break: break-word;
`;

const RawSectionWrapper = styled.div``;

const RawLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
  margin-bottom: 8px;
`;

const ErrorContainer = styled.div`
  color: ${colors.error.var};
`;

const ErrorTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
`;

const ErrorStack = styled.pre`
  ${monoFont};
  font-size: 11px;
  white-space: pre-wrap;
  opacity: 0.8;
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  padding: 10px;
`;

const WarningContainer = styled.div`
  ${stack({ gap: 6 })}
  color: ${colors.warning.var};
  font-size: 12px;
`;

const WarningTitle = styled.div`
  font-weight: 600;
`;

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value === null) return 'null';
  if (value === undefined) return EM_DASH;
  return JSON.stringify(value);
}

function formatMetricValue(metric: LlmCallMetricValue): ReactNode {
  const { rawValue, format, numberFormat } = metric;
  if (rawValue === null) return EM_DASH;

  if (format === 'number') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return formatNumber(rawValue, numberFormat);
    }
    return safeStringify(rawValue);
  }

  if (format === 'duration') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return formatDuration(rawValue);
    }
    return safeStringify(rawValue);
  }

  if (format === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue ? 'Yes' : 'No';
    return safeStringify(rawValue);
  }

  if (format === 'json') {
    if (typeof rawValue === 'string' || typeof rawValue === 'number') {
      return safeStringify(rawValue);
    }
    return (
      <JsonViewer
        value={rawValue}
        compact
        maxHeight="raw"
        collapsed={6}
      />
    );
  }

  return safeStringify(rawValue);
}

function RawSection({ label, data }: { label: string; data: unknown }) {
  return (
    <RawSectionWrapper>
      <RawLabel>{label}</RawLabel>
      <JsonViewer
        value={data}
        compact
        maxHeight="raw"
        collapsed={6}
      />
    </RawSectionWrapper>
  );
}

function formatTokenChip(total: number | null): string {
  if (total === null) return '';
  return `${formatNumber(total)} tok`;
}

function formatCostChip(cost: number | null): string {
  if (cost === null) return '';
  return formatNumber(cost, { prefix: '$', decimalPlaces: 4 });
}

function metricKey(metric: LlmCallMetricValue): string {
  return `${metric.label}-${metric.placements.join(',')}`;
}

/**
 * Render one LLM-call card inside the case-drawer LLM calls tab.
 *
 * Collapsed by default. The header shows the call name, status, model chip,
 * latency, total tokens, cost, and any user-defined metric whose
 * `placements` includes `'header'`. Click toggles expansion to reveal token
 * breakdown, steps/finish/provider, Input / Output / Reasoning / Tool-calls
 * sections (only those with values), body-placement metrics, span warnings,
 * and any captured error.
 */
export function LlmCallRow({ entry }: { entry: LlmCallEntry }) {
  const [expanded, setExpanded] = useState(false);

  const headerMetrics = entry.metrics.filter((m) =>
    m.placements.includes('header'),
  );
  const bodyMetrics = entry.metrics.filter((m) =>
    m.placements.includes('body'),
  );

  const tokenLabel = formatTokenChip(entry.totalTokens);
  const costLabel = formatCostChip(entry.costUsd);
  const latencyLabel =
    entry.latencyMs === null ? null : formatDuration(entry.latencyMs);

  const showTokenBreakdown =
    entry.inputTokens !== null ||
    entry.outputTokens !== null ||
    entry.cachedInputTokens !== null ||
    entry.reasoningTokens !== null ||
    entry.totalTokens !== null;

  const showStepRow =
    entry.steps !== null ||
    entry.finishReason !== null ||
    entry.provider !== null;

  return (
    <Card>
      <HeaderButton
        type="button"
        onClick={() => {
          setExpanded((prev) => !prev);
        }}
        aria-expanded={expanded}
      >
        <Caret>{expanded ? <ChevronDown /> : <ChevronRight />}</Caret>
        <HeaderName>{entry.name}</HeaderName>
        <HeaderMeta>
          <StatusBadge status={entry.status} />
          {entry.model !== null ? <ModelChip>{entry.model}</ModelChip> : null}
          {latencyLabel !== null ? <span>{latencyLabel}</span> : null}
          {tokenLabel ? <span>{tokenLabel}</span> : null}
          {costLabel ? <span>{costLabel}</span> : null}
          {headerMetrics.map((metric) => (
            <MetricChip key={metricKey(metric)}>
              <MetricChipLabel>{metric.label}</MetricChipLabel>
              {formatMetricValue(metric)}
            </MetricChip>
          ))}
        </HeaderMeta>
      </HeaderButton>

      {expanded ? (
        <Body>
          {showTokenBreakdown ? (
            <MetaRow>
              <span>
                Tokens{' '}
                {entry.inputTokens === null
                  ? EM_DASH
                  : formatNumber(entry.inputTokens)}
                {' → '}
                {entry.outputTokens === null
                  ? EM_DASH
                  : formatNumber(entry.outputTokens)}
                {entry.totalTokens !== null
                  ? ` (${formatNumber(entry.totalTokens)})`
                  : ''}
              </span>
              {entry.cachedInputTokens !== null ? (
                <span>cached {formatNumber(entry.cachedInputTokens)}</span>
              ) : null}
              {entry.reasoningTokens !== null ? (
                <span>reasoning {formatNumber(entry.reasoningTokens)}</span>
              ) : null}
            </MetaRow>
          ) : null}

          {showStepRow ? (
            <MetaRow>
              {entry.steps !== null ? (
                <span>Steps {formatNumber(entry.steps)}</span>
              ) : null}
              {entry.finishReason !== null ? (
                <span>Finish {entry.finishReason}</span>
              ) : null}
              {entry.provider !== null ? (
                <span>Provider {entry.provider}</span>
              ) : null}
            </MetaRow>
          ) : null}

          {entry.input !== undefined ? (
            <RawSection
              label="Input"
              data={entry.input}
            />
          ) : null}
          {entry.output !== undefined ? (
            <RawSection
              label="Output"
              data={entry.output}
            />
          ) : null}
          {entry.reasoning !== undefined ? (
            <RawSection
              label="Reasoning"
              data={entry.reasoning}
            />
          ) : null}
          {entry.toolCalls !== undefined ? (
            <RawSection
              label="Tool calls"
              data={entry.toolCalls}
            />
          ) : null}

          {bodyMetrics.map((metric) => (
            <MetricRow key={metricKey(metric)}>
              <MetricRowLabel>{metric.label}</MetricRowLabel>
              <MetricRowValue>{formatMetricValue(metric)}</MetricRowValue>
            </MetricRow>
          ))}

          {entry.warnings.map((warning, i) => (
            <WarningContainer key={`${warning.message}-${String(i)}`}>
              <WarningTitle>
                {warning.name ?? 'Warning'}: {warning.message}
              </WarningTitle>
              {warning.stack ? <ErrorStack>{warning.stack}</ErrorStack> : null}
            </WarningContainer>
          ))}

          {entry.error !== null ? (
            <ErrorContainer>
              <ErrorTitle>
                {entry.error.name ?? 'Error'}: {entry.error.message}
              </ErrorTitle>
              {entry.error.stack ? (
                <ErrorStack>{entry.error.stack}</ErrorStack>
              ) : null}
            </ErrorContainer>
          ) : null}
        </Body>
      ) : null}
    </Card>
  );
}
