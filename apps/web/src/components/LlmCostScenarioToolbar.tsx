import type { LlmCostScenario } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker } from '#src/style/helpers';

const Toolbar = styled.div`
  ${inline({ justify: 'right', align: 'center', gap: 8 })}
  margin-bottom: 12px;
`;

const ToolbarLabel = styled.label`
  ${kicker};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
`;

const ToolbarSelect = styled.select`
  height: 28px;
  min-width: 220px;
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

/**
 * Toolbar rendered above the LLM calls list with a single dropdown that
 * selects the active cost-simulation scenario. When a non-actual scenario is
 * picked, each row renders both the simulated and actual breakdowns
 * side-by-side for comparison.
 */
export function LlmCostScenarioToolbar({
  scenario,
  onChange,
}: {
  scenario: LlmCostScenario;
  onChange: (next: LlmCostScenario) => void;
}) {
  return (
    <Toolbar>
      <ToolbarLabel htmlFor="cost-scenario-select">Simulate cost</ToolbarLabel>
      <ToolbarSelect
        id="cost-scenario-select"
        value={scenario}
        onChange={(e) => {
          onChange(parseCostScenario(e.target.value));
        }}
      >
        <option value="actual">{formatCostScenarioLabel('actual')}</option>
        <option value="noCache">{formatCostScenarioLabel('noCache')}</option>
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
    </Toolbar>
  );
}
