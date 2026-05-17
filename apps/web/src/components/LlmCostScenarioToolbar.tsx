import {
  simulateLlmCallCost,
  simulateTokenAllocation,
  type LlmCallEntry,
  type LlmCostScenario,
  type ResolvedLlmCallPricing,
} from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatNumber } from '#src/utils/formatters';
import {
  formatExactTokens,
  LLM_CALL_EM_DASH,
  LLM_CALL_USD_COST_NUMBER_FORMAT,
} from '#src/utils/llmCallTokenFormat';

const Toolbar = styled.div`
  ${stack({ gap: 8 })}
  margin-bottom: 12px;
`;

const TotalStatsBar = styled.div`
  ${inline({ justify: 'center', align: 'center', gap: 0 })}
  ${monoFont};
  width: 100%;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  flex-wrap: wrap;
`;

const TotalStat = styled.div`
  ${inline({ align: 'center', gap: 6 })}
  white-space: nowrap;

  & + &::before {
    content: '';
    display: block;
    width: 1px;
    height: 14px;
    margin: 0 10px 0 4px;
    background: ${colors.border.var};
  }
`;

const TotalStatLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
`;

const TotalStatValue = styled.span`
  color: ${colors.text.var};
  font-size: 11.5px;
  font-weight: 600;
`;

const CostValue = styled(TotalStatValue)`
  color: ${colors.cost.var};
`;

const ScenarioRow = styled.div`
  ${inline({ justify: 'right', align: 'center', gap: 8 })}
`;

const ScenarioControls = styled.div`
  ${inline({ align: 'center', gap: 8 })}
`;

const ToolbarLabel = styled.label`
  ${kicker};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
`;

const ToolbarSelect = styled.select`
  height: 28px;
  min-width: 210px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  padding: 0 26px 0 9px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;

  &:hover {
    border-color: ${colors.borderStrong.var};
  }

  &:focus {
    outline: 2px solid ${colors.accent.alpha(0.25)};
    outline-offset: 1px;
    border-color: ${colors.accent.alpha(0.65)};
  }
`;

/**
 * Coerce a `<select>` value back to a typed {@link LlmCostScenario}, falling
 * back to `'actual'` for any unrecognized value (e.g. stale persisted state).
 */
export function parseCostScenario(value: string): LlmCostScenario {
  switch (value) {
    case 'noCache':
    case 'withBaseCaching':
    case 'withBaseCachingWrite':
    case 'withExtendedCachingWrite':
      return value;
    default:
      return 'actual';
  }
}

/** Human-readable label used in dropdowns and breakdown column titles. */
export function formatCostScenarioLabel(scenario: LlmCostScenario): string {
  switch (scenario) {
    case 'noCache':
      return 'Without caching';
    case 'withBaseCaching':
      return 'Warmed cache (reads only)';
    case 'withBaseCachingWrite':
      return 'First call · base cache write';
    case 'withExtendedCachingWrite':
      return 'First call · extended cache write';
    case 'actual':
      return 'Actual';
  }
}

function sumNullableCosts(values: readonly (number | null)[]): number | null {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : null;
}

type LlmCallScenarioTotals = {
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
};

/** Sum visible LLM-call metrics for the active scenario. */
export function getLlmCallScenarioTotals({
  entries,
  pricing,
  scenario,
}: {
  entries: LlmCallEntry[];
  pricing: ResolvedLlmCallPricing[];
  scenario: LlmCostScenario;
}): LlmCallScenarioTotals {
  return {
    costUsd: sumNullableCosts(
      entries.map(
        (entry) =>
          simulateLlmCallCost({ entry, pricing, scenario }).totalCostUsd,
      ),
    ),
    inputTokens: sumNullableCosts(entries.map((entry) => entry.inputTokens)),
    outputTokens: sumNullableCosts(entries.map((entry) => entry.outputTokens)),
    cachedInputTokens: sumNullableCosts(
      entries.map(
        (entry) =>
          simulateTokenAllocation({ entry, scenario }).cachedInputTokens,
      ),
    ),
  };
}

function formatTokenStat(value: number | null): string {
  return value === null ? LLM_CALL_EM_DASH : formatExactTokens(value);
}

function LlmCallTotalStatBar({ totals }: { totals: LlmCallScenarioTotals }) {
  return (
    <TotalStatsBar>
      <TotalStat>
        <TotalStatLabel>Total cost</TotalStatLabel>
        <CostValue>
          {formatNumber(totals.costUsd, LLM_CALL_USD_COST_NUMBER_FORMAT)}
        </CostValue>
      </TotalStat>
      <TotalStat>
        <TotalStatLabel>Total in</TotalStatLabel>
        <TotalStatValue>{formatTokenStat(totals.inputTokens)}</TotalStatValue>
      </TotalStat>
      <TotalStat>
        <TotalStatLabel>Out</TotalStatLabel>
        <TotalStatValue>{formatTokenStat(totals.outputTokens)}</TotalStatValue>
      </TotalStat>
      <TotalStat>
        <TotalStatLabel>Cached in</TotalStatLabel>
        <TotalStatValue>
          {formatTokenStat(totals.cachedInputTokens)}
        </TotalStatValue>
      </TotalStat>
    </TotalStatsBar>
  );
}

/**
 * Toolbar rendered above the LLM calls list with a single dropdown that
 * selects the active cost-simulation scenario. When a non-actual scenario is
 * picked, the total reflects the simulated scenario for all visible calls.
 */
export function LlmCostScenarioToolbar({
  entries,
  pricing,
  scenario,
  onChange,
}: {
  entries: LlmCallEntry[];
  pricing: ResolvedLlmCallPricing[];
  scenario: LlmCostScenario;
  onChange: (next: LlmCostScenario) => void;
}) {
  const totals = getLlmCallScenarioTotals({ entries, pricing, scenario });

  return (
    <Toolbar>
      <LlmCallTotalStatBar totals={totals} />
      <ScenarioRow>
        <ScenarioControls>
          <ToolbarLabel htmlFor="cost-scenario-select">
            Simulate cost
          </ToolbarLabel>
          <ToolbarSelect
            id="cost-scenario-select"
            value={scenario}
            onChange={(e) => {
              onChange(parseCostScenario(e.target.value));
            }}
          >
            <option value="actual">{formatCostScenarioLabel('actual')}</option>
            <option value="noCache">
              {formatCostScenarioLabel('noCache')}
            </option>
            <option value="withBaseCaching">
              {formatCostScenarioLabel('withBaseCaching')}
            </option>
            <option value="withBaseCachingWrite">
              {formatCostScenarioLabel('withBaseCachingWrite')}
            </option>
            <option value="withExtendedCachingWrite">
              {formatCostScenarioLabel('withExtendedCachingWrite')}
            </option>
          </ToolbarSelect>
        </ScenarioControls>
      </ScenarioRow>
    </Toolbar>
  );
}
