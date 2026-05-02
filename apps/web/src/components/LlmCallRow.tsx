import {
  simulateLlmCallCost,
  type LlmCallEntry,
  type LlmCallMetricValue,
  type LlmCostScenario,
  type ResolvedLlmCallCostCurrency,
  type ResolvedLlmCallPricing,
} from '@agent-evals/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import {
  buildLlmCallBreakdownItems,
  LlmCallBreakdownTable,
} from '#src/components/LlmCallBreakdownTable';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatDuration, formatNumber } from '#src/utils/formatters';
import {
  formatCompactTokens,
  formatExactTokens,
  LLM_CALL_EM_DASH,
  LLM_CALL_USD_COST_NUMBER_FORMAT,
} from '#src/utils/llmCallTokenFormat';

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

const BreakdownColumns = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const BreakdownColumn = styled.div`
  ${stack({ gap: 6 })}
  min-width: 0;
`;

const BreakdownColumnLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
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
  if (value === undefined) return LLM_CALL_EM_DASH;
  return JSON.stringify(value);
}

function formatMetricValue(metric: LlmCallMetricValue): ReactNode {
  const { rawValue, format, numberFormat } = metric;
  if (rawValue === null) return LLM_CALL_EM_DASH;

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
  return formatNumber(cost, LLM_CALL_USD_COST_NUMBER_FORMAT);
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
      <Tooltip
        content={`Total tokens · exact: ${formatExactTokens(totalTokens)}`}
      >
        <TokenChip>
          {formatCompactTokens(totalTokens)}
          <TokenDirection>tok</TokenDirection>
        </TokenChip>
      </Tooltip>
    );
  }

  const exactBreakdown = [
    inputTokens !== null ? `in ${formatExactTokens(inputTokens)}` : null,
    outputTokens !== null ? `out ${formatExactTokens(outputTokens)}` : null,
    totalTokens !== null ? `total ${formatExactTokens(totalTokens)}` : null,
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
        {inputTokens === null
          ? LLM_CALL_EM_DASH
          : formatCompactTokens(inputTokens)}
        <TokenSeparator>·</TokenSeparator>
        <TokenDirection>out</TokenDirection>
        {outputTokens === null
          ? LLM_CALL_EM_DASH
          : formatCompactTokens(outputTokens)}
      </TokenChip>
    </Tooltip>
  );
}

function metricKey(metric: LlmCallMetricValue): string {
  return `${metric.label}-${metric.placements.join(',')}`;
}

/**
 * Render one LLM-call card inside the case-drawer LLM calls tab.
 *
 * Collapsed by default. The header shows the call name, status, model chip,
 * latency, duration, total tokens, cost, and any user-defined metric whose
 * `placements` includes `'header'`. Click toggles expansion to reveal token
 * breakdown, built-in and body-placement metrics, then the JSON sections in
 * order: Input / Output / Reasoning / Steps (when the configured `steps`
 * attribute resolved to an array) / Tool calls. Span warnings and any captured
 * error render at the bottom.
 *
 * `scenario` controls how costs are displayed. `'actual'` uses the recorded
 * costs as-is. The simulated scenarios (`'noCache'`, `'withBaseCaching'`,
 * `'withBaseCachingWrite'`, `'withExtendedCachingWrite'`) recompute costs from
 * the resolved `pricing` so users can compare what the same usage would have
 * cost under a different cache strategy. The header chip and breakdown total
 * reflect the active scenario.
 */
export function LlmCallRow({
  entry,
  costCurrencies,
  scenario,
  pricing,
}: {
  entry: LlmCallEntry;
  costCurrencies: ResolvedLlmCallCostCurrency[];
  scenario: LlmCostScenario;
  pricing: ResolvedLlmCallPricing[];
}) {
  const [expanded, setExpanded] = useState(false);

  const headerMetrics = entry.metrics.filter((m) =>
    m.placements.includes('header'),
  );
  const bodyMetrics = entry.metrics.filter((m) =>
    m.placements.includes('body'),
  );

  const simulated = simulateLlmCallCost({ entry, pricing, scenario });
  const actualBreakdown = simulateLlmCallCost({
    entry,
    pricing,
    scenario: 'actual',
  });
  const simulatedItems = buildLlmCallBreakdownItems({
    entry,
    scenario,
    simulated,
  });
  const actualItems = buildLlmCallBreakdownItems({
    entry,
    scenario: 'actual',
    simulated: actualBreakdown,
  });
  const isSimulated = scenario !== 'actual';
  const headerCost = simulated.totalCostUsd ?? entry.costUsd;
  const costLabel = formatCostChip(headerCost);
  const latencyLabel =
    entry.latencyMs === null ? null : formatDuration(entry.latencyMs);
  const durationLabel =
    entry.durationMs === null ? null : formatDuration(entry.durationMs);

  const showTokenBreakdown =
    entry.inputTokens !== null ||
    entry.outputTokens !== null ||
    entry.cachedInputTokens !== null ||
    entry.reasoningTokens !== null ||
    entry.totalTokens !== null;

  const showMetricsSection =
    entry.stepCount !== null ||
    entry.latencyMs !== null ||
    entry.durationMs !== null ||
    entry.tokensPerSecond !== null ||
    entry.finishReason !== null ||
    entry.provider !== null ||
    bodyMetrics.length > 0;

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
          {latencyLabel !== null ? (
            <MetricChip>
              <MetricChipLabel>Latency</MetricChipLabel>
              {latencyLabel}
            </MetricChip>
          ) : null}
          {durationLabel !== null ? (
            <MetricChip>
              <MetricChipLabel>Duration</MetricChipLabel>
              {durationLabel}
            </MetricChip>
          ) : null}
          <HeaderTokenChip
            inputTokens={entry.inputTokens}
            outputTokens={entry.outputTokens}
            totalTokens={entry.totalTokens}
          />
          {costLabel ? (
            isSimulated &&
            entry.costUsd !== null &&
            entry.costUsd !== headerCost ? (
              <Tooltip
                content={`Simulated · actual: ${formatNumber(entry.costUsd, LLM_CALL_USD_COST_NUMBER_FORMAT)}`}
              >
                <span>{costLabel}</span>
              </Tooltip>
            ) : (
              <span>{costLabel}</span>
            )
          ) : null}
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
            isSimulated ? (
              <BreakdownColumns>
                <BreakdownColumn>
                  <BreakdownColumnLabel>Simulated</BreakdownColumnLabel>
                  <LlmCallBreakdownTable
                    entry={entry}
                    costCurrencies={costCurrencies}
                    scenario={scenario}
                    simulated={simulated}
                    items={simulatedItems}
                  />
                </BreakdownColumn>
                <BreakdownColumn>
                  <BreakdownColumnLabel>Actual</BreakdownColumnLabel>
                  <LlmCallBreakdownTable
                    entry={entry}
                    costCurrencies={costCurrencies}
                    scenario="actual"
                    simulated={actualBreakdown}
                    items={actualItems}
                  />
                </BreakdownColumn>
              </BreakdownColumns>
            ) : (
              <LlmCallBreakdownTable
                entry={entry}
                costCurrencies={costCurrencies}
                scenario={scenario}
                simulated={simulated}
                items={simulatedItems}
              />
            )
          ) : null}

          {showMetricsSection ? (
            <MetricsSection>
              {entry.stepCount !== null ? (
                <MetricRow>
                  <MetricRowLabel>Steps</MetricRowLabel>
                  <MetricRowValue>
                    {formatNumber(entry.stepCount)}
                  </MetricRowValue>
                </MetricRow>
              ) : null}
              {latencyLabel !== null ? (
                <MetricRow>
                  <MetricRowLabel>Latency</MetricRowLabel>
                  <MetricRowValue>{latencyLabel}</MetricRowValue>
                </MetricRow>
              ) : null}
              {durationLabel !== null ? (
                <MetricRow>
                  <MetricRowLabel>Duration</MetricRowLabel>
                  <MetricRowValue>{durationLabel}</MetricRowValue>
                </MetricRow>
              ) : null}
              {entry.tokensPerSecond !== null ? (
                <MetricRow>
                  <MetricRowLabel>Tokens/sec</MetricRowLabel>
                  <MetricRowValue>
                    {formatNumber(entry.tokensPerSecond, {
                      minDecimalPlaces: 1,
                      maxDecimalPlaces: 1,
                    })}
                  </MetricRowValue>
                </MetricRow>
              ) : null}
              {entry.finishReason !== null ? (
                <MetricRow>
                  <MetricRowLabel>Finish</MetricRowLabel>
                  <MetricRowValue>{entry.finishReason}</MetricRowValue>
                </MetricRow>
              ) : null}
              {entry.provider !== null ? (
                <MetricRow>
                  <MetricRowLabel>Provider</MetricRowLabel>
                  <MetricRowValue>{entry.provider}</MetricRowValue>
                </MetricRow>
              ) : null}
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
