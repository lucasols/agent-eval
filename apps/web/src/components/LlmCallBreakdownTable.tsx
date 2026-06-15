import {
  simulateTokenAllocation,
  type LlmCallCostBreakdown,
  type LlmCallEntry,
  type LlmCostScenario,
  type NumberDisplayOptions,
  type ResolvedLlmCallCostCurrency,
} from '@agent-evals/shared';
import { styled } from 'vindur';
import { Tooltip } from '#src/components/Tooltip';
import { colors } from '#src/style/colors';
import { kicker, monoFont } from '#src/style/helpers';
import { formatNumber } from '#src/utils/formatters';
import {
  formatExactTokens,
  LLM_CALL_EM_DASH,
  LLM_CALL_USD_COST_NUMBER_FORMAT,
} from '#src/utils/llmCallTokenFormat';

const BreakdownTable = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: hidden;
`;

const BreakdownHeader = styled.tr`
  ${kicker};
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
`;

const BreakdownHeaderCell = styled.th`
  padding: 8px 12px;
  text-align: left;
  font-weight: 600;

  &:not(:first-child) {
    text-align: right;
  }
`;

const BreakdownRow = styled.tr`
  font-size: 12px;

  & > td {
    border-top: 1px solid ${colors.border.var};
  }
`;

const BreakdownLabelCell = styled.td`
  padding: 8px 12px;
`;

const BreakdownLabel = styled.span`
  color: ${colors.text.var};
`;

const BreakdownValue = styled.td`
  ${monoFont};
  padding: 8px 12px;
  color: ${colors.text.var};
  text-align: right;
  min-width: 56px;
`;

const BreakdownSubtotalRow = styled(BreakdownRow)`
  background: ${colors.surface.alpha(0.5)};
  font-weight: 500;
  color: ${colors.textMuted.var};
`;

const BreakdownTotalRow = styled(BreakdownRow)`
  background: ${colors.surface.var};
  font-weight: 600;
`;

const BreakdownDim = styled.span`
  color: ${colors.textMuted.var};
`;

function resolveCurrencyNumberFormat(currency: ResolvedLlmCallCostCurrency) {
  return currency.numberFormat ?? { prefix: `${currency.code} ` };
}

function formatConvertedCost(
  costUsd: number,
  currency: ResolvedLlmCallCostCurrency,
): string {
  return formatNumber(
    costUsd * currency.usdToCurrencyRate,
    resolveCurrencyNumberFormat(currency),
  );
}

function formatTokenCount(value: number | null): string {
  return value === null ? LLM_CALL_EM_DASH : formatExactTokens(value);
}

function CurrencyHeader({
  currency,
}: {
  currency: ResolvedLlmCallCostCurrency;
}) {
  return (
    <Tooltip content={currency.label}>
      <span>{currency.code}</span>
    </Tooltip>
  );
}

function UsdCostValue({ value }: { value: number | null }) {
  if (value === null) return <BreakdownDim>{LLM_CALL_EM_DASH}</BreakdownDim>;
  return <>{formatNumber(value, LLM_CALL_USD_COST_NUMBER_FORMAT)}</>;
}

function ConvertedCostValue({
  value,
  currency,
}: {
  value: number | null;
  currency: ResolvedLlmCallCostCurrency;
}) {
  if (value === null) return <BreakdownDim>{LLM_CALL_EM_DASH}</BreakdownDim>;
  return <>{formatConvertedCost(value, currency)}</>;
}

const TOOLTIP_USD_NUMBER_FORMAT = {
  prefix: '$',
  maxDecimalPlaces: 10,
} satisfies NumberDisplayOptions;

const TOOLTIP_RATE_NUMBER_FORMAT = {
  prefix: '$',
  maxDecimalPlaces: 8,
} satisfies NumberDisplayOptions;

function buildUsdCostTooltip(
  tokens: number | null,
  cost: number | null,
): string | undefined {
  if (tokens === null || tokens === 0) return undefined;
  if (cost === null) {
    return `${formatExactTokens(tokens)} tokens — no pricing configured for this model`;
  }
  if (cost === 0) {
    return `${formatExactTokens(tokens)} tokens · no extra cost in this scenario`;
  }
  const ratePerMillion = (cost / tokens) * 1_000_000;
  return `${formatExactTokens(tokens)} × ${formatNumber(
    ratePerMillion,
    TOOLTIP_RATE_NUMBER_FORMAT,
  )}/1M = ${formatNumber(cost, TOOLTIP_USD_NUMBER_FORMAT)}`;
}

function buildConvertedCostTooltip(
  costUsd: number | null,
  currency: ResolvedLlmCallCostCurrency,
): string | undefined {
  if (costUsd === null || costUsd === 0) return undefined;
  const tooltipCurrencyFormat = {
    ...resolveCurrencyNumberFormat(currency),
    maxDecimalPlaces: 10,
  } satisfies NumberDisplayOptions;
  return `${formatNumber(costUsd, TOOLTIP_USD_NUMBER_FORMAT)} × ${currency.code} ${formatNumber(
    currency.usdToCurrencyRate,
    { maxDecimalPlaces: 8 },
  )}/USD = ${formatNumber(
    costUsd * currency.usdToCurrencyRate,
    tooltipCurrencyFormat,
  )}`;
}

type BreakdownItem = {
  key: string;
  label: string;
  tokens: number | null;
  cost: number | null;
};

type BreakdownItemWithTooltip = BreakdownItem & { tooltip?: string };

const inputItemKeys = new Set([
  'input',
  'cacheCreationInput',
  'cacheReadInput',
]);

/**
 * Render the per-token-type breakdown for one LLM call inside the LLM calls
 * tab. Costs reflect the active `scenario`: `'actual'` shows the recorded
 * billed cost while simulated scenarios re-derive each row from `simulated`.
 *
 * The table renders one row per visible token type (input / cache write /
 * cache read / output / reasoning), an optional "Total input" subtotal that
 * sums the input-side rows when at least one is visible, and a final "Total"
 * row driven by the simulated total cost. When the active scenario differs
 * from `'actual'`, the total cost cell carries a tooltip with the actual
 * recorded cost so users can compare against the simulation.
 */
export function LlmCallBreakdownTable({
  entry,
  costCurrencies,
  scenario,
  simulated,
  items,
}: {
  entry: LlmCallEntry;
  costCurrencies: ResolvedLlmCallCostCurrency[];
  scenario: LlmCostScenario;
  simulated: LlmCallCostBreakdown;
  items: BreakdownItemWithTooltip[];
}) {
  const isSimulated = scenario !== 'actual';

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

  const visibleInputItems = visible.filter((item) =>
    inputItemKeys.has(item.key),
  );
  let inputCostSum: number | null = null;
  for (const item of visibleInputItems) {
    if (item.cost === null) continue;
    inputCostSum = (inputCostSum ?? 0) + item.cost;
  }
  const inputTokensSum = entry.inputTokens;
  const showInputSubtotal =
    visibleInputItems.length > 0 &&
    (inputTokensSum !== null || inputCostSum !== null);

  let breakdownCostSum: number | null = null;
  for (const item of visible) {
    if (item.cost === null) continue;
    breakdownCostSum = (breakdownCostSum ?? 0) + item.cost;
  }

  const totalCostUsd = isSimulated
    ? (simulated.totalCostUsd ?? breakdownCostSum)
    : (entry.costUsd ?? breakdownCostSum);
  const totalTooltip =
    isSimulated && entry.costUsd !== null && entry.costUsd !== totalCostUsd
      ? `Actual cost: ${formatNumber(entry.costUsd, LLM_CALL_USD_COST_NUMBER_FORMAT)}`
      : null;

  return (
    <BreakdownTable>
      <thead>
        <BreakdownHeader>
          <BreakdownHeaderCell>Token type</BreakdownHeaderCell>
          <BreakdownHeaderCell>Tokens</BreakdownHeaderCell>
          <BreakdownHeaderCell>Cost</BreakdownHeaderCell>
          {costCurrencies.map((currency, index) => (
            <BreakdownHeaderCell key={`${currency.code}-${String(index)}`}>
              <CurrencyHeader currency={currency} />
            </BreakdownHeaderCell>
          ))}
        </BreakdownHeader>
      </thead>
      <tbody>
        {visible.map((item) => (
          <BreakdownRow key={item.key}>
            <BreakdownLabelCell>
              <Tooltip content={item.tooltip}>
                <BreakdownLabel>{item.label}</BreakdownLabel>
              </Tooltip>
            </BreakdownLabelCell>
            <BreakdownValue>{formatTokenCount(item.tokens)}</BreakdownValue>
            <BreakdownValue>
              <Tooltip content={buildUsdCostTooltip(item.tokens, item.cost)}>
                <span>
                  <UsdCostValue value={item.cost} />
                </span>
              </Tooltip>
            </BreakdownValue>
            {costCurrencies.map((currency, index) => (
              <BreakdownValue key={`${currency.code}-${String(index)}`}>
                <Tooltip
                  content={buildConvertedCostTooltip(item.cost, currency)}
                >
                  <span>
                    <ConvertedCostValue
                      value={item.cost}
                      currency={currency}
                    />
                  </span>
                </Tooltip>
              </BreakdownValue>
            ))}
          </BreakdownRow>
        ))}
        {showInputSubtotal ? (
          <BreakdownSubtotalRow>
            <BreakdownLabelCell>
              <Tooltip content="Sum of input, cache write, and cache read tokens and costs.">
                <BreakdownLabel>Total input</BreakdownLabel>
              </Tooltip>
            </BreakdownLabelCell>
            <BreakdownValue>{formatTokenCount(inputTokensSum)}</BreakdownValue>
            <BreakdownValue>
              <UsdCostValue value={inputCostSum} />
            </BreakdownValue>
            {costCurrencies.map((currency, index) => (
              <BreakdownValue key={`${currency.code}-${String(index)}`}>
                <ConvertedCostValue
                  value={inputCostSum}
                  currency={currency}
                />
              </BreakdownValue>
            ))}
          </BreakdownSubtotalRow>
        ) : null}
        {entry.totalTokens !== null || totalCostUsd !== null ? (
          <BreakdownTotalRow>
            <BreakdownLabelCell>
              <BreakdownLabel>Total</BreakdownLabel>
            </BreakdownLabelCell>
            <BreakdownValue>
              {formatTokenCount(entry.totalTokens)}
            </BreakdownValue>
            <BreakdownValue>
              {totalCostUsd !== null ? (
                totalTooltip !== null ? (
                  <Tooltip content={totalTooltip}>
                    <span>
                      <UsdCostValue value={totalCostUsd} />
                    </span>
                  </Tooltip>
                ) : (
                  <UsdCostValue value={totalCostUsd} />
                )
              ) : (
                <BreakdownDim>{LLM_CALL_EM_DASH}</BreakdownDim>
              )}
            </BreakdownValue>
            {costCurrencies.map((currency, index) => (
              <BreakdownValue key={`${currency.code}-${String(index)}`}>
                <ConvertedCostValue
                  value={totalCostUsd}
                  currency={currency}
                />
              </BreakdownValue>
            ))}
          </BreakdownTotalRow>
        ) : null}
      </tbody>
    </BreakdownTable>
  );
}

/**
 * Build the list of breakdown rows shown in {@link LlmCallBreakdownTable} for
 * a given LLM call and active simulation scenario.
 *
 * Each scenario re-shapes the input-side rows so simulated tokens follow the
 * simulated cost: `noCache` folds reads/writes into base input, the
 * `withBaseCaching*` scenarios may shift uncached input into the cache
 * read/write rows when the call has no real caching, etc. Rows hidden by the
 * caller's filtering rules in the breakdown table still appear here so the
 * table can decide which to render based on token + cost availability.
 */
export function buildLlmCallBreakdownItems({
  entry,
  scenario,
  simulated,
}: {
  entry: LlmCallEntry;
  scenario: LlmCostScenario;
  simulated: LlmCallCostBreakdown;
}): BreakdownItemWithTooltip[] {
  const isSimulated = scenario !== 'actual';
  const hasAnyCaching =
    (entry.cachedInputTokens !== null && entry.cachedInputTokens > 0) ||
    (entry.cacheCreationInputTokens !== null &&
      entry.cacheCreationInputTokens > 0);
  const isFirstCallWriteScenario =
    scenario === 'withBaseCachingWrite' ||
    scenario === 'withExtendedCachingWrite';
  const isWarmedNoActualCache =
    scenario === 'withBaseCaching' && !hasAnyCaching;
  const isFirstCallNoActualCache = isFirstCallWriteScenario && !hasAnyCaching;
  const tokens = simulateTokenAllocation({ entry, scenario });

  const inputTooltipBase =
    'Input tokens billed at the base input rate. Cache read/write tokens are subtracted here and shown on their own rows.';
  const inputSimulationTooltip =
    scenario === 'noCache'
      ? 'For the "without caching" scenario, every input token (including read/write portions) is billed at the base input rate.'
      : isWarmedNoActualCache
        ? 'Warmed-cache scenario without any actual cache: base input is folded into the Cache read row.'
        : isFirstCallNoActualCache
          ? 'First-call scenario without any actual cache: base input is folded into the Cache write row.'
          : null;
  const cacheWriteTooltipBase =
    'Tokens written to the prompt cache. Providers like Anthropic charge a premium for cache creation (e.g. 1.25× / 2× the base input rate).';
  const cacheWriteSimulationTooltip =
    scenario === 'noCache'
      ? 'Cache writes folded into Input at the base input rate for the "without caching" scenario.'
      : scenario === 'withBaseCaching'
        ? 'Warmed cache: cache writes are treated as already paid (free).'
        : scenario === 'withBaseCachingWrite'
          ? hasAnyCaching
            ? 'First-call scenario: cache writes billed at the base (5-minute) cache write rate.'
            : 'First-call scenario: every input token billed at the base (5-minute) cache write rate, as if this call were warming up the base cache.'
          : hasAnyCaching
            ? "First-call scenario: cache writes billed at the extended cache write rate (e.g. Anthropic's 1-hour TTL)."
            : "First-call scenario: every input token billed at the extended cache write rate (e.g. Anthropic's 1-hour TTL), as if this call were warming up the extended cache.";
  const cacheReadTooltipBase =
    'Tokens read from the prompt cache. Typically billed at a deep discount (e.g. 0.1× the base input rate on Anthropic).';
  const cacheReadSimulationTooltip =
    scenario === 'noCache'
      ? 'Cache reads folded into Input at the base input rate for the "without caching" scenario.'
      : isWarmedNoActualCache
        ? 'Warmed-cache scenario: every input token is treated as a cache read.'
        : null;

  return [
    {
      key: 'input',
      label: 'Input',
      tooltip: inputSimulationTooltip ?? inputTooltipBase,
      tokens: tokens.baseInputTokens,
      cost: simulated.inputCostUsd,
    },
    {
      key: 'cacheCreationInput',
      label: 'Cache write',
      tooltip: isSimulated
        ? cacheWriteSimulationTooltip
        : cacheWriteTooltipBase,
      tokens: tokens.cacheCreationInputTokens,
      cost: simulated.cacheCreationInputCostUsd,
    },
    {
      key: 'cacheReadInput',
      label: 'Cache read',
      tooltip: cacheReadSimulationTooltip ?? cacheReadTooltipBase,
      tokens: tokens.cachedInputTokens,
      cost: simulated.cachedInputCostUsd,
    },
    {
      key: 'output',
      label: 'Output',
      tokens: entry.outputTokens,
      cost: simulated.outputCostUsd,
    },
    {
      key: 'reasoning',
      label: 'Reasoning',
      tooltip:
        'Reasoning output tokens. When these are included in Output, their cost is counted there and not billed again.',
      tokens: entry.reasoningTokens,
      cost: simulated.reasoningCostUsd,
    },
  ];
}
