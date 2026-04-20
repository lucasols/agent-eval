import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { kicker, monoFont } from '#src/style/helpers';
import { formatCost, formatTimestamp } from '../utils/formatters.ts';

type ChartPoint = {
  index: number;
  startedAt: string;
  score: number;
  cost: number | null;
};

type EvalRunsChartProps = { data: ChartPoint[] };

const ChartFrame = styled.div`
  height: 210px;
  padding: 10px 14px 8px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-lg);
  background: ${colors.bg.var};
`;

const TooltipBox = styled.div`
  ${monoFont}
  background: ${colors.bg.var};
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 11px;
  line-height: 1.5;
  color: ${colors.text.var};
  min-width: 160px;
  box-shadow: 0 10px 30px -10px ${colors.black.alpha(0.18)};
`;

const TooltipRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 14px;

  & + & {
    margin-top: 4px;
  }
`;

const TooltipKey = styled.span`
  ${kicker}
  color: ${colors.textMuted.var};
`;

const TooltipScore = styled.span`
  color: ${colors.accentDim.var};
`;

const tickStyle = {
  fill: colors.textMuted.var,
  fontSize: 10,
  fontFamily: 'Geist Mono, JetBrains Mono, monospace',
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
        <TooltipScore>{point.score.toFixed(2)}</TooltipScore>
      </TooltipRow>
      <TooltipRow>
        <TooltipKey>cost</TooltipKey>
        <span>{formatCost(point.cost)}</span>
      </TooltipRow>
    </TooltipBox>
  );
}

export function EvalRunsChart({ data }: EvalRunsChartProps) {
  return (
    <ChartFrame>
      <ResponsiveContainer
        width="100%"
        height="100%"
      >
        <AreaChart
          data={data}
          margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
        >
          <defs>
            <linearGradient
              id="evalScoreFill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={colors.accent.var}
                stopOpacity={0.32}
              />
              <stop
                offset="100%"
                stopColor={colors.accent.var}
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke={colors.border.var}
            strokeDasharray="2 5"
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
            width={30}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: colors.accent.alpha(0.5),
              strokeWidth: 1,
              strokeDasharray: '3 3',
            }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke={colors.accent.var}
            strokeWidth={1.75}
            fill="url(#evalScoreFill)"
            dot={{
              r: 2.5,
              fill: colors.bg.var,
              stroke: colors.accent.var,
              strokeWidth: 1.75,
            }}
            activeDot={{
              r: 4,
              fill: colors.bg.var,
              stroke: colors.accent.var,
              strokeWidth: 1.75,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
