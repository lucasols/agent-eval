import { styled } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { inline, monoFont } from '#src/style/helpers.ts';

type CostBadgeProps = {
  billedCost: number | null;
  uncachedCost?: number | null;
  savings?: number | null;
};

function formatUsd(value: number | null): string {
  if (value === null) return '\u2014';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

const CostContainer = styled.span`
  ${inline({ gap: 8 })}
  display: inline-flex;
  color: ${colors.cost.var};
  font-weight: 600;
  ${monoFont}
  font-size: 13px;
`;

const SavingsLabel = styled.span`
  font-size: 11px;
  color: ${colors.success.var};
`;

export function CostBadge({ billedCost, uncachedCost, savings }: CostBadgeProps) {
  return (
    <CostContainer>
      <span title="Billed cost">{formatUsd(billedCost)}</span>
      {savings !== null && savings !== undefined && savings > 0 ? (
        <SavingsLabel
          title={`Saved ${formatUsd(savings)} (uncached: ${formatUsd(uncachedCost ?? null)})`}
        >
          saved {formatUsd(savings)}
        </SavingsLabel>
      ) : null}
    </CostContainer>
  );
}
