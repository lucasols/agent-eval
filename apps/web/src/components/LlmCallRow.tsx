import type { LlmCallEntry, LlmCallMetricValue } from '@agent-evals/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
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

const TokenChip = styled.span`
  ${inline({ gap: 4, align: 'center' })}
  ${monoFont};
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const TokenDirection = styled.span`
  color: ${colors.textDim.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const TokenSeparator = styled.span`
  color: ${colors.borderStrong.var};
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

const BreakdownTable = styled.div`
  ${stack({ gap: 0 })}
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: hidden;
`;

const BreakdownHeader = styled.div`
  ${kicker};
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  padding: 8px 12px;
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
`;

const BreakdownRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  padding: 8px 12px;
  align-items: baseline;
  border-top: 1px solid ${colors.border.var};
  font-size: 12px;
`;

const BreakdownLabel = styled.span`
  color: ${colors.text.var};
`;

const BreakdownValue = styled.span`
  ${monoFont};
  color: ${colors.text.var};
  text-align: right;
  min-width: 56px;
`;

const BreakdownTotalRow = styled(BreakdownRow)`
  background: ${colors.surface.var};
  font-weight: 600;
`;

const BreakdownColumnHeader = styled.span`
  text-align: right;
`;

const BreakdownDim = styled.span`
  color: ${colors.textMuted.var};
`;

const RawSectionWrapper = styled.div``;

const RawLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
  margin-bottom: 8px;
`;

const MetricsSection = styled.div`
  ${stack({ gap: 6 })}
`;

const StepsWrapper = styled.div`
  ${stack({ gap: 8 })}
`;

const StepCard = styled.div`
  ${stack({ gap: 6 })}
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  padding: 8px 10px;
`;

const StepHeader = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
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

function StepsSection({ steps }: { steps: unknown[] }) {
  if (steps.length === 0) return null;
  return (
    <RawSectionWrapper>
      <RawLabel>Steps</RawLabel>
      <StepsWrapper>
        {steps.map((step, index) => (
          <StepCard key={String(index)}>
            <StepHeader>Step {index + 1}</StepHeader>
            <JsonViewer
              value={step}
              compact
              maxHeight="raw"
              collapsed={4}
            />
          </StepCard>
        ))}
      </StepsWrapper>
    </RawSectionWrapper>
  );
}

function formatCostChip(cost: number | null): string {
  if (cost === null) return '';
  return formatNumber(cost, { prefix: '$', decimalPlaces: 4 });
}

const compactTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

function formatCompactTokens(value: number): string {
  return compactTokenFormatter.format(value);
}

function HeaderTokenChip({
  inputTokens,
  outputTokens,
  totalTokens,
}: {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}) {
  const hasDirectional = inputTokens !== null || outputTokens !== null;

  if (!hasDirectional) {
    if (totalTokens === null) return null;
    return (
      <Tooltip content={`Total tokens · exact: ${formatNumber(totalTokens)}`}>
        <TokenChip>
          {formatCompactTokens(totalTokens)}
          <TokenDirection>tok</TokenDirection>
        </TokenChip>
      </Tooltip>
    );
  }

  const exactBreakdown = [
    inputTokens !== null ? `in ${formatNumber(inputTokens)}` : null,
    outputTokens !== null ? `out ${formatNumber(outputTokens)}` : null,
    totalTokens !== null ? `total ${formatNumber(totalTokens)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <Tooltip
      content={
        exactBreakdown.length > 0
          ? `Input · Output tokens · exact: ${exactBreakdown}`
          : 'Input · Output tokens'
      }
    >
      <TokenChip>
        <TokenDirection>in</TokenDirection>
        {inputTokens === null ? EM_DASH : formatCompactTokens(inputTokens)}
        <TokenSeparator>·</TokenSeparator>
        <TokenDirection>out</TokenDirection>
        {outputTokens === null ? EM_DASH : formatCompactTokens(outputTokens)}
      </TokenChip>
    </Tooltip>
  );
}

function metricKey(metric: LlmCallMetricValue): string {
  return `${metric.label}-${metric.placements.join(',')}`;
}

function formatTokenCount(value: number | null): string {
  return value === null ? EM_DASH : formatNumber(value);
}

function formatCostValue(value: number | null): string {
  return value === null
    ? EM_DASH
    : formatNumber(value, { prefix: '$', decimalPlaces: 4 });
}

type BreakdownItem = {
  key: string;
  label: string;
  tokens: number | null;
  cost: number | null;
};

type BreakdownItemWithTooltip = BreakdownItem & { tooltip?: string };

function TokenBreakdownTable({ entry }: { entry: LlmCallEntry }) {
  const items: BreakdownItemWithTooltip[] = [
    {
      key: 'input',
      label: 'Input',
      tokens: entry.inputTokens,
      cost: entry.inputCostUsd,
    },
    {
      key: 'cacheCreationInput',
      label: 'Cache write',
      tooltip:
        'Tokens written to the prompt cache. Providers like Anthropic charge a premium for cache creation (e.g. 1.25× / 2× the base input rate).',
      tokens: entry.cacheCreationInputTokens,
      cost: entry.cacheCreationInputCostUsd,
    },
    {
      key: 'cacheReadInput',
      label: 'Cache read',
      tooltip:
        'Tokens read from the prompt cache. Typically billed at a deep discount (e.g. 0.1× the base input rate on Anthropic).',
      tokens: entry.cachedInputTokens,
      cost: entry.cachedInputCostUsd,
    },
    {
      key: 'output',
      label: 'Output',
      tokens: entry.outputTokens,
      cost: entry.outputCostUsd,
    },
    {
      key: 'reasoning',
      label: 'Reasoning',
      tokens: entry.reasoningTokens,
      cost: entry.reasoningCostUsd,
    },
  ];

  const visible = items.filter(
    (item) => item.tokens !== null || item.cost !== null,
  );

  if (
    visible.length === 0 &&
    entry.totalTokens === null &&
    entry.costUsd === null
  ) {
    return null;
  }

  let breakdownCostSum: number | null = null;
  for (const item of visible) {
    if (item.cost === null) continue;
    breakdownCostSum = (breakdownCostSum ?? 0) + item.cost;
  }

  return (
    <BreakdownTable>
      <BreakdownHeader>
        <span>Token type</span>
        <BreakdownColumnHeader>Tokens</BreakdownColumnHeader>
        <BreakdownColumnHeader>Cost</BreakdownColumnHeader>
      </BreakdownHeader>
      {visible.map((item) => (
        <BreakdownRow key={item.key}>
          <Tooltip content={item.tooltip}>
            <BreakdownLabel>{item.label}</BreakdownLabel>
          </Tooltip>
          <BreakdownValue>{formatTokenCount(item.tokens)}</BreakdownValue>
          <BreakdownValue>
            {item.cost === null ? (
              <BreakdownDim>{EM_DASH}</BreakdownDim>
            ) : (
              formatCostValue(item.cost)
            )}
          </BreakdownValue>
        </BreakdownRow>
      ))}
      {entry.totalTokens !== null || entry.costUsd !== null ? (
        <BreakdownTotalRow>
          <BreakdownLabel>Total</BreakdownLabel>
          <BreakdownValue>{formatTokenCount(entry.totalTokens)}</BreakdownValue>
          <BreakdownValue>
            {entry.costUsd !== null ? (
              formatCostValue(entry.costUsd)
            ) : breakdownCostSum !== null ? (
              <Tooltip content="Sum of per-token costs above">
                <span>{formatCostValue(breakdownCostSum)}</span>
              </Tooltip>
            ) : (
              <BreakdownDim>{EM_DASH}</BreakdownDim>
            )}
          </BreakdownValue>
        </BreakdownTotalRow>
      ) : null}
    </BreakdownTable>
  );
}

/**
 * Render one LLM-call card inside the case-drawer LLM calls tab.
 *
 * Collapsed by default. The header shows the call name, status, model chip,
 * latency, total tokens, cost, and any user-defined metric whose
 * `placements` includes `'header'`. Click toggles expansion to reveal token
 * breakdown, steps/finish/provider, body-placement metrics, then the JSON
 * sections in order: Input / Output / Reasoning / Steps (when the configured
 * `steps` attribute resolved to an array) / Tool calls. Span warnings and any
 * captured error render at the bottom.
 */
export function LlmCallRow({ entry }: { entry: LlmCallEntry }) {
  const [expanded, setExpanded] = useState(false);

  const headerMetrics = entry.metrics.filter((m) =>
    m.placements.includes('header'),
  );
  const bodyMetrics = entry.metrics.filter((m) =>
    m.placements.includes('body'),
  );

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
    entry.stepCount !== null ||
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
          <HeaderTokenChip
            inputTokens={entry.inputTokens}
            outputTokens={entry.outputTokens}
            totalTokens={entry.totalTokens}
          />
          {costLabel ? <span>{costLabel}</span> : null}
          {headerMetrics.map((metric) => (
            <Tooltip
              key={metricKey(metric)}
              content={metric.tooltip}
            >
              <MetricChip>
                <MetricChipLabel>{metric.label}</MetricChipLabel>
                {formatMetricValue(metric)}
              </MetricChip>
            </Tooltip>
          ))}
        </HeaderMeta>
      </HeaderButton>

      {expanded ? (
        <Body>
          {showTokenBreakdown || entry.costUsd !== null ? (
            <TokenBreakdownTable entry={entry} />
          ) : null}

          {showStepRow ? (
            <MetaRow>
              {entry.stepCount !== null ? (
                <span>Steps {formatNumber(entry.stepCount)}</span>
              ) : null}
              {entry.finishReason !== null ? (
                <span>Finish {entry.finishReason}</span>
              ) : null}
              {entry.provider !== null ? (
                <span>Provider {entry.provider}</span>
              ) : null}
            </MetaRow>
          ) : null}

          {bodyMetrics.length > 0 ? (
            <MetricsSection>
              {bodyMetrics.map((metric) => (
                <MetricRow key={metricKey(metric)}>
                  <Tooltip content={metric.tooltip}>
                    <MetricRowLabel>{metric.label}</MetricRowLabel>
                  </Tooltip>
                  <MetricRowValue>{formatMetricValue(metric)}</MetricRowValue>
                </MetricRow>
              ))}
            </MetricsSection>
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
          {entry.stepDetails !== null ? (
            <StepsSection steps={entry.stepDetails} />
          ) : null}
          {entry.toolCalls !== undefined ? (
            <RawSection
              label="Tool calls"
              data={entry.toolCalls}
            />
          ) : null}

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
