import type {
  EvalChartConfig,
  EvalChartMetric,
  EvalChartTooltipExtra,
} from '@agent-evals/shared';

type ChartValuesPoint = { values: Record<string, number | null> };

function visibilityMetricId(
  metric: EvalChartMetric | EvalChartTooltipExtra,
): string {
  if (metric.source === 'builtin') return `builtin:${metric.metric}`;
  return `column:${metric.key}:${metric.aggregate}`;
}

export function chartHasNumericValue(
  config: EvalChartConfig,
  data: ChartValuesPoint[],
): boolean {
  const allMetrics: Array<EvalChartMetric | EvalChartTooltipExtra> = [
    ...config.metrics,
    ...(config.tooltipExtras ?? []),
  ];

  return data.some((point) =>
    allMetrics.some((metric) => {
      const value = point.values[visibilityMetricId(metric)];
      return typeof value === 'number' && Number.isFinite(value);
    }),
  );
}
