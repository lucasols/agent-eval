import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, monoFont } from '#src/style/helpers';
import { formatCost } from '../utils/formatters.ts';

type CostBadgeProps = {
  billedCost: number | null;
  uncachedCost?: number | null;
  savings?: number | null;
};

const CostContainer = styled.span`
  ${inline({ gap: 8 })}
  ${monoFont}
  display: inline-flex;
  color: ${colors.cost.var};
  font-size: 12px;
  font-weight: 500;
`;

const SavingsLabel = styled.span`
  ${monoFont}
  font-size: 11px;
  color: ${colors.success.var};
  font-weight: 400;
`;

export function CostBadge({
  billedCost,
  uncachedCost,
  savings,
}: CostBadgeProps) {
  return (
    <CostContainer>
      <span title="Billed cost">{formatCost(billedCost)}</span>
      {savings !== null && savings !== undefined && savings > 0 ? (
        <SavingsLabel
          title={`Saved ${formatCost(savings)} (uncached: ${formatCost(uncachedCost ?? null)})`}
        >
          -{formatCost(savings)}
        </SavingsLabel>
      ) : null}
    </CostContainer>
  );
}
