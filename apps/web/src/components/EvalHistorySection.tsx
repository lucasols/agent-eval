import { type ColumnDef, type EvalChartConfig } from '@agent-evals/shared';
import { ChevronDown } from 'lucide-react';
import { styled } from 'vindur';
import { EvalRunsChart } from '#src/components/EvalRunsChart';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  monoFont,
  stack,
  transition,
} from '#src/style/helpers';
import { type ChartPoint } from '#src/utils/chartData';

type EvalHistorySectionProps = {
  collapsed: boolean;
  chartLabels: string[];
  completedRunCount: number;
  visibleCharts: Array<{ config: EvalChartConfig; data: ChartPoint[] }>;
  columnDefs: ColumnDef[];
  onToggle: () => void;
};

const Root = styled.div`
  ${stack({ gap: 0 })}
  padding: 20px 32px 24px;
  border-bottom: 1px solid ${colors.border.var};
`;

const SectionLabel = styled.div<{ collapsed: boolean }>`
  ${inline({ justify: 'space-between', align: 'center' })}
  margin-bottom: 14px;

  &.collapsed {
    margin-bottom: 0;
  }
`;

const SectionLabelLeft = styled.button`
  ${inline({ gap: 8, align: 'center' })}
  min-width: 0;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
`;

const SectionChevron = styled.span<{ open: boolean }>`
  ${transition({ property: 'transform' })}
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};
  transform: rotate(-90deg);

  &.open {
    transform: rotate(0deg);
  }

  & > svg {
    width: 14px;
    height: 14px;
  }
`;

const SectionLabelText = styled.span`
  font-size: 13.5px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;
`;

const SectionMeta = styled.span`
  ${monoFont};
  font-size: 10.5px;
  color: ${colors.textMuted.var};
`;

const SectionLabelRight = styled.span`
  ${inline({ justify: 'right', align: 'center', gap: 10 })}
  min-width: 0;
  flex: 1;
`;

const CollapsedChartLabels = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  min-width: 0;
  justify-content: flex-end;
  color: ${colors.textMuted.var};
  font-size: 12px;
`;

const CollapsedChartLabelItem = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  min-width: 0;
`;

const CollapsedChartLabel = styled.span`
  ${ellipsis};
  max-width: 180px;
`;

const CollapsedChartSeparator = styled.span`
  color: ${colors.textMuted.var};
`;

export function EvalHistorySection({
  collapsed,
  chartLabels,
  completedRunCount,
  visibleCharts,
  columnDefs,
  onToggle,
}: EvalHistorySectionProps) {
  return (
    <Root>
      <SectionLabel collapsed={collapsed}>
        <SectionLabelLeft
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? 'Expand history charts' : 'Collapse history charts'
          }
        >
          <SectionChevron open={!collapsed}>
            <ChevronDown />
          </SectionChevron>
          <SectionLabelText>History</SectionLabelText>
        </SectionLabelLeft>
        <SectionLabelRight>
          {collapsed ? (
            <CollapsedChartLabels>
              {chartLabels.map((label, index) => (
                <CollapsedChartLabelItem key={`${label}-${index}`}>
                  {index > 0 ? (
                    <CollapsedChartSeparator>·</CollapsedChartSeparator>
                  ) : null}
                  <CollapsedChartLabel>{label}</CollapsedChartLabel>
                </CollapsedChartLabelItem>
              ))}
            </CollapsedChartLabels>
          ) : (
            <SectionMeta>
              {completedRunCount} {completedRunCount === 1 ? 'run' : 'runs'}
            </SectionMeta>
          )}
        </SectionLabelRight>
      </SectionLabel>
      {collapsed
        ? null
        : visibleCharts.map(({ config, data }, i) => (
            <EvalRunsChart
              key={`chart-${i}`}
              config={config}
              data={data}
              columnDefs={columnDefs}
            />
          ))}
    </Root>
  );
}
