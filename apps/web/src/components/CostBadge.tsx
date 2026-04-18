import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, monoFont } from '#src/style/helpers';
import { formatCost } from '../utils/formatters.ts';

type CostBadgeProps = {
  billedCost: number | null;
};

const CostContainer = styled.span`
  ${inline({ gap: 8 })}
  ${monoFont}
  display: inline-flex;
  color: ${colors.cost.var};
  font-size: 12px;
  font-weight: 500;
`;

export function CostBadge({ billedCost }: CostBadgeProps) {
  return (
    <CostContainer>
      <span title="Billed cost">{formatCost(billedCost)}</span>
    </CostContainer>
  );
}
