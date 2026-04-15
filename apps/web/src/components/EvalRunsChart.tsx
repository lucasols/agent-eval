import { styled } from 'vindur';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { colors } from '#src/style/colors';
import { centerContent, monoFont, stack } from '#src/style/helpers';
import { formatCost, formatTimestamp } from '../utils/formatters.ts';

type ChartPoint = {
  index: number;
  startedAt: string;
  score: number;
  cost: number | null;
};

type EvalRunsChartProps = {
  data: ChartPoint[];
};

const ChartFrame = styled.div`
  height: 180px;
  padding: 8px 8px 4px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bgElevated.var};
`;

const Placeholder = styled.div`
  ${centerContent}
  ${stack({ align: 'center', gap: 6 })}
  height: 180px;
  border: 1px dashed ${colors.border.var};
  border-radius: var(--radius-md);
  color: ${colors.textDim.var};
  font-size: 12px;
  background: ${colors.bgElevated.var};
`;

const TooltipBox = styled.div`
  ${monoFont}
  background: ${colors.surface.var};
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 11px;
  color: ${colors.text.var};
  min-width: 140px;
`;

const TooltipRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;

  & + & {
    margin-top: 2px;
  }
`;

const TooltipKey = styled.span`
  color: ${colors.textDim.var};
`;

const tickStyle = {
  fill: colors.textDim.var,
  fontSize: 10,
  fontFamily: 'JetBrains Mono, monospace',
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <TooltipBox>
      <TooltipRow>
        <TooltipKey>when</TooltipKey>
        <span>{formatTimestamp(point.startedAt)}</span>
      </TooltipRow>
      <TooltipRow>
        <TooltipKey>score</TooltipKey>
        <span>{point.score.toFixed(2)}</span>
      </TooltipRow>
      <TooltipRow>
        <TooltipKey>cost</TooltipKey>
        <span>{formatCost(point.cost)}</span>
      </TooltipRow>
    </TooltipBox>
  );
}

export function EvalRunsChart({ data }: EvalRunsChartProps) {
  if (data.length <= 1) {
    return <Placeholder>No run history yet</Placeholder>;
  }

  return (
    <ChartFrame>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        >
          <defs>
            <linearGradient id="evalScoreFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.accent.var} stopOpacity={0.35} />
              <stop offset="100%" stopColor={colors.accent.var} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke={colors.border.var}
            strokeDasharray="2 4"
            horizontal
            vertical={false}
          />
          <XAxis
            dataKey="index"
            tick={tickStyle}
            stroke={colors.border.var}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.5, 1]}
            tick={tickStyle}
            stroke={colors.border.var}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: colors.borderStrong.var, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke={colors.accent.var}
            strokeWidth={1.5}
            fill="url(#evalScoreFill)"
            dot={{
              r: 2.5,
              fill: colors.accent.var,
              stroke: colors.bg.var,
              strokeWidth: 1,
            }}
            activeDot={{
              r: 4,
              fill: colors.accent.var,
              stroke: colors.bg.var,
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
