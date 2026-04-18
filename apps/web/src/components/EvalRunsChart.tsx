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
import { monoFont } from '#src/style/helpers';
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
  height: 200px;
  padding: 12px 12px 4px;
  border: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.alpha(0.5)};
  position: relative;

  &::before {
    content: 'SCORE · 0.0 → 1.0';
    position: absolute;
    top: 10px;
    left: 14px;
    font-family:
      'JetBrains Mono', 'SF Mono', 'Fira Code', 'Fira Mono', ui-monospace,
      monospace;
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.24em;
    color: ${colors.textDim.var};
    z-index: 1;
    pointer-events: none;
  }
`;

const TooltipBox = styled.div`
  ${monoFont}
  background: ${colors.bg.var};
  border: 1px solid ${colors.accent.alpha(0.4)};
  padding: 10px 12px;
  font-size: 10.5px;
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
  color: ${colors.textDim.var};
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 9px;
`;

const tickStyle = {
  fill: colors.textDim.var,
  fontSize: 9,
  fontFamily: 'JetBrains Mono, monospace',
  letterSpacing: '0.1em',
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
  return (
    <ChartFrame>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 18, right: 12, bottom: 4, left: 0 }}
        >
          <defs>
            <linearGradient id="evalScoreFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.accent.var} stopOpacity={0.45} />
              <stop offset="100%" stopColor={colors.accent.var} stopOpacity={0} />
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
            cursor={{ stroke: colors.accent.alpha(0.5), strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke={colors.accent.var}
            strokeWidth={1.75}
            fill="url(#evalScoreFill)"
            dot={{
              r: 3,
              fill: colors.bg.var,
              stroke: colors.accent.var,
              strokeWidth: 1.5,
            }}
            activeDot={{
              r: 5,
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
