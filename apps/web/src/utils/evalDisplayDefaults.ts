import type {
  ColumnDef,
  EvalChartConfig,
  EvalStatItem,
} from '@agent-evals/shared';

const BASELINE_STATS: EvalStatItem[] = [
  { kind: 'cases' },
  { kind: 'passRate', accent: true },
  { kind: 'duration' },
];

const USAGE_STAT_CONFIGS = [
  {
    key: 'apiCalls',
    stat: {
      kind: 'column',
      key: 'apiCalls',
      label: 'API Calls',
      aggregate: 'avg',
      numberFormat: { minDecimalPlaces: 0, maxDecimalPlaces: 0 },
      hideIfNoValue: true,
    },
  },
  {
    key: 'costUsd',
    stat: {
      kind: 'column',
      key: 'costUsd',
      label: 'LLM Cost',
      aggregate: 'avg',
      numberFormat: { prefix: '$', maxDecimalPlaces: 4 },
      hideIfNoValue: true,
    },
  },
  {
    key: 'totalTokens',
    stat: {
      kind: 'column',
      key: 'totalTokens',
      label: 'Tokens',
      aggregate: 'avg',
      numberFormat: { notation: 'compact' },
      hideIfNoValue: true,
    },
  },
  {
    key: 'llmTurns',
    stat: {
      kind: 'column',
      key: 'llmTurns',
      label: 'LLM Turns',
      aggregate: 'avg',
      numberFormat: { minDecimalPlaces: 0, maxDecimalPlaces: 0 },
      hideIfNoValue: true,
    },
  },
] as const satisfies Array<{ key: string; stat: EvalStatItem }>;

const BASELINE_HISTORY_CHART: EvalChartConfig = {
  heading: 'Run History',
  type: 'line',
  metrics: [
    {
      source: 'builtin',
      metric: 'passRate',
      label: 'Pass rate',
      color: 'success',
    },
    {
      source: 'builtin',
      metric: 'durationMs',
      label: 'Duration',
      color: 'warning',
      axis: 'right',
    },
  ],
  yDomain: { left: { min: 0, max: 1 } },
};

const COST_CHART: EvalChartConfig = {
  heading: 'LLM Cost',
  hideIfNoValue: true,
  dedupeConsecutiveValues: true,
  type: 'area',
  metrics: [
    {
      source: 'column',
      key: 'costUsd',
      aggregate: 'avg',
      label: 'Actual',
      color: 'warning',
    },
    {
      source: 'column',
      key: 'costUsdWithoutCache',
      aggregate: 'avg',
      label: 'Without Cache',
      color: 'error',
    },
    {
      source: 'column',
      key: 'costUsdWarmedCache',
      aggregate: 'avg',
      label: 'Warmed Cache',
      color: 'success',
    },
  ],
};

const INPUT_TOKEN_CHART: EvalChartConfig = {
  heading: 'LLM Input Tokens',
  hideIfNoValue: true,
  dedupeConsecutiveValues: true,
  type: 'bar',
  metrics: [
    {
      source: 'column',
      key: 'inputTokens',
      aggregate: 'avg',
      label: 'Input',
      color: 'accent',
    },
    {
      source: 'column',
      key: 'cachedInputTokens',
      aggregate: 'avg',
      label: 'Cached Input',
      color: 'error',
    },
    {
      source: 'column',
      key: 'cacheCreationInputTokens',
      aggregate: 'avg',
      label: 'Cache Write',
      color: 'warning',
    },
  ],
};

const OUTPUT_TOKEN_CHART: EvalChartConfig = {
  heading: 'LLM Output Tokens',
  hideIfNoValue: true,
  dedupeConsecutiveValues: true,
  type: 'bar',
  metrics: [
    {
      source: 'column',
      key: 'outputTokens',
      aggregate: 'avg',
      label: 'Output',
      color: 'success',
    },
  ],
};

const LLM_TURNS_CHART: EvalChartConfig = {
  heading: 'LLM Turns',
  hideIfNoValue: true,
  dedupeConsecutiveValues: true,
  type: 'line',
  metrics: [
    {
      source: 'column',
      key: 'llmTurns',
      aggregate: 'avg',
      label: 'Turns',
      color: 'accentDim',
    },
  ],
};

const USAGE_CHART_CONFIGS = [
  {
    keys: ['costUsd', 'costUsdWithoutCache', 'costUsdWarmedCache'],
    chart: COST_CHART,
  },
  { keys: ['llmTurns'], chart: LLM_TURNS_CHART },
  {
    keys: ['inputTokens', 'cachedInputTokens', 'cacheCreationInputTokens'],
    chart: INPUT_TOKEN_CHART,
  },
  { keys: ['outputTokens'], chart: OUTPUT_TOKEN_CHART },
] as const satisfies Array<{ keys: string[]; chart: EvalChartConfig }>;

function statKindExists(stats: EvalStatItem[], kind: EvalStatItem['kind']) {
  return stats.some((stat) => stat.kind === kind);
}

function statColumnExists(stats: EvalStatItem[], key: string) {
  return stats.some((stat) => stat.kind === 'column' && stat.key === key);
}

function chartHasBaselineMetric(chart: EvalChartConfig): boolean {
  return chart.metrics.some((metric) => metric.source === 'builtin');
}

function chartHasColumnMetric(chart: EvalChartConfig, key: string): boolean {
  return chart.metrics.some(
    (metric) => metric.source === 'column' && metric.key === key,
  );
}

function columnKeySet(columnDefs: ColumnDef[]): Set<string> {
  return new Set(columnDefs.map((columnDef) => columnDef.key));
}

export function buildDisplayStats(params: {
  stats: EvalStatItem[] | undefined;
  columnDefs: ColumnDef[];
}): EvalStatItem[] {
  const stats = params.stats ?? [];
  const missingBaselineStats = BASELINE_STATS.filter(
    (stat) => !statKindExists(stats, stat.kind),
  );
  const keys = columnKeySet(params.columnDefs);
  const missingUsageStats =
    params.stats === undefined
      ? USAGE_STAT_CONFIGS.filter(
          ({ key }) => keys.has(key) && !statColumnExists(stats, key),
        ).map(({ stat }) => stat)
      : [];
  return [...missingBaselineStats, ...stats, ...missingUsageStats];
}

export function buildDisplayCharts(params: {
  charts: EvalChartConfig[] | undefined;
  columnDefs: ColumnDef[];
}): EvalChartConfig[] {
  const charts = params.charts ?? [];
  const keys = columnKeySet(params.columnDefs);
  const missingBaselineCharts = charts.some(chartHasBaselineMetric)
    ? []
    : [BASELINE_HISTORY_CHART];
  const missingUsageCharts =
    params.charts === undefined
      ? USAGE_CHART_CONFIGS.filter(
          ({ keys: chartKeys }) =>
            chartKeys.some((key) => keys.has(key)) &&
            !chartKeys.some((key) =>
              charts.some((chart) => chartHasColumnMetric(chart, key)),
            ),
        ).map(({ chart }) => chart)
      : [];
  return [...missingBaselineCharts, ...charts, ...missingUsageCharts];
}
