import type {
  CaseRow,
  ColumnDef,
  EvalChartAggregate,
  EvalChartConfig,
  EvalChartMetric,
  EvalChartTooltipExtra,
  RunManifest,
  ScopedCaseSummary,
} from '@agent-evals/shared';

const RUN_SHORT_ID_PREFIX = /^r/;

type ChartScopedCaseSummary = Omit<ScopedCaseSummary, 'status'> & {
  status: ScopedCaseSummary['status'] | 'unscored';
};

type ChartRunRow = {
  manifest: RunManifest;
  summary: ChartScopedCaseSummary;
  cases: CaseRow[];
};

/**
 * One point in a per-eval history chart series. `values` is flat-keyed using
 * `metricId` so both the data builder and the chart component look up series
 * values under the same string key that recharts requires for `dataKey`.
 */
export type ChartPoint = {
  axisLabel: string;
  shortId: string;
  startedAt: string;
  values: Record<string, number | null>;
};

type UnlabeledChartPoint = Omit<ChartPoint, 'axisLabel'>;

/**
 * Stable, deterministic series id used for recharts `dataKey` lookups and for
 * keying aggregated values on `ChartPoint.values`. Shapes: `builtin:<metric>`
 * for run-level metrics, `column:<key>:<aggregate>` for per-case column
 * aggregations.
 */
export function metricId(
  metric: EvalChartMetric | EvalChartTooltipExtra,
): string {
  if (metric.source === 'builtin') return `builtin:${metric.metric}`;
  return `column:${metric.key}:${metric.aggregate}`;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function aggregateColumn(params: {
  values: number[];
  aggregate: EvalChartAggregate;
  passThreshold: number | undefined;
}): number | null {
  const { values, aggregate, passThreshold } = params;
  if (values.length === 0) return null;
  switch (aggregate) {
    case 'avg': {
      const total = values.reduce((acc, v) => acc + v, 0);
      return total / values.length;
    }
    case 'sum':
      return values.reduce((acc, v) => acc + v, 0);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'latest':
      return values[values.length - 1] ?? null;
    case 'passThresholdRate': {
      if (passThreshold === undefined) return null;
      const meeting = values.filter((v) => v >= passThreshold).length;
      return meeting / values.length;
    }
  }
}

function computeColumnValue(params: {
  row: ChartRunRow;
  key: string;
  aggregate: EvalChartAggregate;
  columnsByKey: Map<string, ColumnDef>;
}): number | null {
  const { row, key, aggregate, columnsByKey } = params;
  const columnDef = columnsByKey.get(key);
  const finiteValues: number[] = [];
  for (const caseRow of row.cases) {
    const value = caseRow.columns[key];
    const finite = toFiniteNumber(value);
    if (finite !== null) finiteValues.push(finite);
  }
  return aggregateColumn({
    values: finiteValues,
    aggregate,
    passThreshold: columnDef?.passThreshold,
  });
}

function computeBuiltinValue(params: {
  row: ChartRunRow;
  metric: 'passRate' | 'durationMs';
}): number | null {
  const { row, metric } = params;
  switch (metric) {
    case 'passRate':
      if (row.summary.totalCases === 0) return null;
      return row.summary.passedCases / row.summary.totalCases;
    case 'durationMs':
      return row.summary.totalDurationMs;
  }
}

function computeMetricValue(params: {
  row: ChartRunRow;
  metric: EvalChartMetric | EvalChartTooltipExtra;
  columnsByKey: Map<string, ColumnDef>;
}): number | null {
  const { row, metric, columnsByKey } = params;
  if (metric.source === 'builtin') {
    return computeBuiltinValue({ row, metric: metric.metric });
  }
  return computeColumnValue({
    row,
    key: metric.key,
    aggregate: metric.aggregate,
    columnsByKey,
  });
}

function chartValuesAreEqual(params: {
  left: UnlabeledChartPoint;
  right: UnlabeledChartPoint;
  keys: string[];
}): boolean {
  return params.keys.every(
    (key) => params.left.values[key] === params.right.values[key],
  );
}

function dedupeChartPoints(params: {
  points: UnlabeledChartPoint[];
  keys: string[];
}): UnlabeledChartPoint[] {
  const deduped: UnlabeledChartPoint[] = [];
  for (const point of params.points) {
    const previous = deduped.at(-1);
    if (
      previous !== undefined &&
      chartValuesAreEqual({ left: previous, right: point, keys: params.keys })
    ) {
      continue;
    }
    deduped.push(point);
  }
  return deduped;
}

/**
 * Build chart points for one eval history chart from the last N completed runs
 * for the scoped eval. Only completed runs with at least one case contribute,
 * matching the current chart behavior. The oldest-first output is what recharts
 * expects; the newest kept point is labeled `LATEST`.
 */
export function buildChartPoints(params: {
  rows: ChartRunRow[];
  config: EvalChartConfig;
  columnDefs: ColumnDef[];
  limit?: number;
}): ChartPoint[] {
  const { rows, config, columnDefs, limit = 20 } = params;
  const columnsByKey = new Map(columnDefs.map((def) => [def.key, def]));
  const completed = [...rows]
    .reverse()
    .filter(
      (row) =>
        row.manifest.status === 'completed' && row.summary.totalCases > 0,
    )
    .slice(-limit);

  const allMetrics: Array<EvalChartMetric | EvalChartTooltipExtra> = [
    ...config.metrics,
    ...(config.tooltipExtras ?? []),
  ];
  const metricKeys = allMetrics.map(metricId);

  const points = completed.map((row) => {
    const values: Record<string, number | null> = {};
    for (const metric of allMetrics) {
      values[metricId(metric)] = computeMetricValue({
        row,
        metric,
        columnsByKey,
      });
    }
    return {
      shortId: row.manifest.shortId,
      startedAt: row.manifest.startedAt,
      values,
    };
  });

  const renderedPoints =
    config.dedupeConsecutiveValues === true
      ? dedupeChartPoints({ points, keys: metricKeys })
      : points;

  return renderedPoints.map((point, index, list) => ({
    ...point,
    axisLabel:
      index === list.length - 1
        ? 'LATEST'
        : point.shortId.replace(RUN_SHORT_ID_PREFIX, ''),
  }));
}
