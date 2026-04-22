import type {
  ColumnDef,
  EvalChartAggregate,
  EvalChartColor,
  EvalChartConfig,
  EvalChartMetric,
  EvalChartTooltipExtra,
} from '@agent-evals/shared';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { kicker, monoFont } from '#src/style/helpers';
import { metricId, type ChartPoint } from '../utils/chartData.ts';
import {
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
  formatTimestamp,
} from '../utils/formatters.ts';

type EvalRunsChartProps = {
  config: EvalChartConfig;
  data: ChartPoint[];
  columnDefs: ColumnDef[];
};

const ChartFrame = styled.div`
  height: 150px;
  padding: 10px 14px 8px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-lg);
  background: ${colors.bg.var};
`;

const ChartTitle = styled.div`
  ${kicker}
  color: ${colors.textMuted.var};
  padding: 0 2px 4px;
`;

const ChartStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TooltipBox = styled.div`
  ${monoFont}
  padding: 10px 12px;
  font-size: 11px;
  line-height: 1.5;
  color: ${colors.text.var};
  min-width: 160px;
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

const DEFAULT_COLOR_ROTATION: EvalChartColor[] = [
  'accent',
  'accentDim',
  'warning',
  'success',
  'cost',
  'error',
];

function resolveColor(color: EvalChartColor): string {
  return colors[color].var;
}

function pickColor(
  metric: EvalChartMetric,
  fallbackIndex: number,
): EvalChartColor {
  if (metric.color !== undefined) return metric.color;
  const fallback =
    DEFAULT_COLOR_ROTATION[fallbackIndex % DEFAULT_COLOR_ROTATION.length];
  return fallback ?? 'accent';
}

function builtinLabel(metric: 'passRate' | 'cost' | 'durationMs'): string {
  if (metric === 'passRate') return 'pass rate';
  if (metric === 'cost') return 'cost';
  return 'duration';
}

function resolveLabel(
  metric: EvalChartMetric | EvalChartTooltipExtra,
  columnsByKey: Map<string, ColumnDef>,
): string {
  if (metric.label !== undefined) return metric.label;
  if (metric.source === 'builtin') return builtinLabel(metric.metric);
  const column = columnsByKey.get(metric.key);
  const base = column?.label ?? metric.key;
  const suffix = aggregateSuffix(metric.aggregate);
  return suffix === '' ? base : `${base} ${suffix}`;
}

function aggregateSuffix(aggregate: EvalChartAggregate): string {
  switch (aggregate) {
    case 'avg':
      return '(avg)';
    case 'sum':
      return '(sum)';
    case 'min':
      return '(min)';
    case 'max':
      return '(max)';
    case 'latest':
      return '(latest)';
    case 'passThresholdRate':
      return '(pass rate)';
  }
}

function formatBuiltin(
  metric: 'passRate' | 'cost' | 'durationMs',
  value: number | null,
): string {
  if (value === null) return '—';
  if (metric === 'passRate') return formatPercent(value);
  if (metric === 'cost') return formatCost(value);
  return formatDuration(value);
}

function formatColumnValue(
  metric: Extract<
    EvalChartMetric | EvalChartTooltipExtra,
    { source: 'column' }
  >,
  value: number | null,
  columnsByKey: Map<string, ColumnDef>,
): string {
  if (value === null) return '—';
  if (metric.aggregate === 'passThresholdRate') return formatPercent(value);
  const column = columnsByKey.get(metric.key);
  if (column?.format === 'percent') return formatPercent(value);
  if (column?.format === 'usd') return formatCost(value);
  if (column?.format === 'duration') return formatDuration(value);
  return formatScore(value);
}

function formatMetricValue(
  metric: EvalChartMetric | EvalChartTooltipExtra,
  value: number | null,
  columnsByKey: Map<string, ColumnDef>,
): string {
  if (metric.source === 'builtin') return formatBuiltin(metric.metric, value);
  return formatColumnValue(metric, value, columnsByKey);
}

function ChartTooltip({
  active,
  payload,
  config,
  columnsByKey,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  config: EvalChartConfig;
  columnsByKey: Map<string, ColumnDef>;
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
      {config.metrics.map((metric, i) => {
        const key = metricId(metric);
        const value = point.values[key] ?? null;
        const useAccent =
          (metric.color ??
            DEFAULT_COLOR_ROTATION[i % DEFAULT_COLOR_ROTATION.length]) ===
          'accent';
        return (
          <TooltipRow key={`metric-${key}`}>
            <TooltipKey>{resolveLabel(metric, columnsByKey)}</TooltipKey>
            {useAccent ? (
              <TooltipScore>
                {formatMetricValue(metric, value, columnsByKey)}
              </TooltipScore>
            ) : (
              <span>{formatMetricValue(metric, value, columnsByKey)}</span>
            )}
          </TooltipRow>
        );
      })}
      {config.tooltipExtras?.map((extra) => {
        const key = metricId(extra);
        const value = point.values[key] ?? null;
        return (
          <TooltipRow key={`extra-${key}`}>
            <TooltipKey>{resolveLabel(extra, columnsByKey)}</TooltipKey>
            <span>{formatMetricValue(extra, value, columnsByKey)}</span>
          </TooltipRow>
        );
      })}
    </TooltipBox>
  );
}

function yAxisProps(
  yAxisId: 'left' | 'right',
  config: EvalChartConfig,
): {
  yAxisId: 'left' | 'right';
  orientation: 'left' | 'right';
  domain?: [number | 'auto', number | 'auto'];
  ticks?: number[];
  tick: typeof tickStyle;
  stroke: string;
  tickLine: false;
  axisLine: false;
  width: number;
} {
  const side = config.yDomain?.[yAxisId];
  const min = side?.min;
  const max = side?.max;
  const hasDomain = min !== undefined || max !== undefined;
  const domain: [number | 'auto', number | 'auto'] | undefined = hasDomain
    ? [min ?? 'auto', max ?? 'auto']
    : undefined;
  const ticks = min === 0 && max === 1 ? [0, 0.5, 1] : undefined;
  return {
    yAxisId,
    orientation: yAxisId,
    domain,
    ticks,
    tick: tickStyle,
    stroke: colors.border.var,
    tickLine: false,
    axisLine: false,
    width: 30,
  };
}

function renderSeries(params: {
  config: EvalChartConfig;
  columnsByKey: Map<string, ColumnDef>;
}): React.ReactNode[] {
  const { config } = params;
  return config.metrics.map((metric, i) => {
    const key = metricId(metric);
    const color = resolveColor(pickColor(metric, i));
    const yAxisId = metric.axis ?? 'left';
    if (config.type === 'area') {
      const useGradient = config.metrics.length === 1;
      const gradientId = `evalChartFill-${key}`;
      return (
        <Area
          key={key}
          type="monotone"
          dataKey={(point: ChartPoint) => point.values[key] ?? null}
          name={key}
          yAxisId={yAxisId}
          stroke={color}
          strokeWidth={1.75}
          fill={useGradient ? `url(#${gradientId})` : color}
          fillOpacity={useGradient ? 1 : 0.15}
          dot={{
            r: 2.5,
            fill: colors.bg.var,
            stroke: color,
            strokeWidth: 1.75,
          }}
          activeDot={{
            r: 4,
            fill: colors.bg.var,
            stroke: color,
            strokeWidth: 1.75,
          }}
          isAnimationActive={false}
        />
      );
    }
    if (config.type === 'line') {
      return (
        <Line
          key={key}
          type="monotone"
          dataKey={(point: ChartPoint) => point.values[key] ?? null}
          name={key}
          yAxisId={yAxisId}
          stroke={color}
          strokeWidth={1.75}
          dot={{
            r: 2.5,
            fill: colors.bg.var,
            stroke: color,
            strokeWidth: 1.75,
          }}
          activeDot={{
            r: 4,
            fill: colors.bg.var,
            stroke: color,
            strokeWidth: 1.75,
          }}
          isAnimationActive={false}
        />
      );
    }
    return (
      <Bar
        key={key}
        dataKey={(point: ChartPoint) => point.values[key] ?? null}
        name={key}
        yAxisId={yAxisId}
        fill={color}
        isAnimationActive={false}
      />
    );
  });
}

function renderGradientDefs(config: EvalChartConfig): React.ReactNode {
  if (config.type !== 'area' || config.metrics.length !== 1) return null;
  const [metric] = config.metrics;
  if (!metric) return null;
  const key = metricId(metric);
  const color = resolveColor(pickColor(metric, 0));
  const gradientId = `evalChartFill-${key}`;
  return (
    <defs>
      <linearGradient
        id={gradientId}
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0%"
          stopColor={color}
          stopOpacity={0.32}
        />
        <stop
          offset="100%"
          stopColor={color}
          stopOpacity={0}
        />
      </linearGradient>
    </defs>
  );
}

export function EvalRunsChart({
  config,
  data,
  columnDefs,
}: EvalRunsChartProps) {
  const columnsByKey = new Map(columnDefs.map((def) => [def.key, def]));
  const hasRightAxis = config.metrics.some((m) => m.axis === 'right');

  const chartChildren = (
    <>
      {renderGradientDefs(config)}
      <CartesianGrid
        stroke={colors.border.var}
        strokeDasharray="2 5"
        horizontal
        vertical={false}
      />
      <XAxis
        dataKey="axisLabel"
        tick={tickStyle}
        stroke={colors.border.var}
        tickLine={false}
        axisLine={false}
        interval="preserveStartEnd"
        angle={-55}
        textAnchor="end"
        height={56}
        tickMargin={8}
      />
      <YAxis {...yAxisProps('left', config)} />
      {hasRightAxis && <YAxis {...yAxisProps('right', config)} />}
      <Tooltip
        content={
          <ChartTooltip
            config={config}
            columnsByKey={columnsByKey}
          />
        }
        wrapperStyle={{
          background: colors.white.var,
          border: `1px solid ${colors.borderStrong.var}`,
          borderRadius: 8,
          boxShadow: `0 10px 30px -10px ${colors.black.alpha(0.18)}`,
          outline: 'none',
        }}
        cursor={{
          stroke: colors.accent.alpha(0.5),
          strokeWidth: 1,
          strokeDasharray: '3 3',
        }}
      />
      {renderSeries({ config, columnsByKey })}
    </>
  );

  const chartMargin = { top: 12, right: 12, bottom: 4, left: 0 };

  return (
    <ChartStack>
      {config.heading !== undefined && (
        <ChartTitle>{config.heading}</ChartTitle>
      )}
      <ChartFrame>
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          {config.type === 'area' ? (
            <AreaChart
              data={data}
              margin={chartMargin}
            >
              {chartChildren}
            </AreaChart>
          ) : config.type === 'line' ? (
            <LineChart
              data={data}
              margin={chartMargin}
            >
              {chartChildren}
            </LineChart>
          ) : (
            <BarChart
              data={data}
              margin={chartMargin}
            >
              {chartChildren}
            </BarChart>
          )}
        </ResponsiveContainer>
      </ChartFrame>
    </ChartStack>
  );
}
