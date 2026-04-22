import type {
  ColumnDef,
  EvalChartConfig,
  EvalChartMetric,
  EvalChartsConfig,
  EvalChartTooltipExtra,
} from '@agent-evals/shared';

type ValidationResult = {
  charts: EvalChartsConfig | undefined;
  warnings: string[];
};

function isValidColumnMetric(
  metric: Extract<EvalChartMetric, { source: 'column' }>,
  columnsByKey: Map<string, ColumnDef>,
  evalId: string,
  warnings: string[],
): boolean {
  const columnDef = columnsByKey.get(metric.key);
  if (!columnDef) {
    warnings.push(
      `[${evalId}] chart metric references unknown column "${metric.key}" — dropped`,
    );
    return false;
  }
  if (metric.aggregate === 'passThresholdRate') {
    if (
      columnDef.isScore !== true ||
      typeof columnDef.passThreshold !== 'number'
    ) {
      warnings.push(
        `[${evalId}] chart metric "${metric.key}" uses "passThresholdRate" but the column is not a score with passThreshold — dropped`,
      );
      return false;
    }
  }
  return true;
}

function isValidTooltipExtra(
  extra: Extract<EvalChartTooltipExtra, { source: 'column' }>,
  columnsByKey: Map<string, ColumnDef>,
  evalId: string,
  warnings: string[],
): boolean {
  const columnDef = columnsByKey.get(extra.key);
  if (!columnDef) {
    warnings.push(
      `[${evalId}] chart tooltip extra references unknown column "${extra.key}" — dropped`,
    );
    return false;
  }
  if (extra.aggregate === 'passThresholdRate') {
    if (
      columnDef.isScore !== true ||
      typeof columnDef.passThreshold !== 'number'
    ) {
      warnings.push(
        `[${evalId}] chart tooltip extra "${extra.key}" uses "passThresholdRate" but the column is not a score with passThreshold — dropped`,
      );
      return false;
    }
  }
  return true;
}

function sanitizeChart(
  chart: EvalChartConfig,
  columnsByKey: Map<string, ColumnDef>,
  evalId: string,
  warnings: string[],
): EvalChartConfig | null {
  const metrics = chart.metrics.filter((metric) => {
    if (metric.source === 'builtin') return true;
    return isValidColumnMetric(metric, columnsByKey, evalId, warnings);
  });
  if (metrics.length === 0) {
    warnings.push(
      `[${evalId}] chart had no valid metrics after validation — chart dropped`,
    );
    return null;
  }
  const tooltipExtras = chart.tooltipExtras?.filter((extra) => {
    if (extra.source === 'builtin') return true;
    return isValidTooltipExtra(extra, columnsByKey, evalId, warnings);
  });
  return {
    ...chart,
    metrics,
    tooltipExtras: tooltipExtras?.length ? tooltipExtras : undefined,
  };
}

/**
 * Validate and sanitize an authored `charts` config against the eval's
 * declared columns. Drops metrics/extras that reference unknown columns or
 * misuse `passThresholdRate`, and drops entire charts whose metrics are all
 * invalid. Returns `charts: undefined` when nothing valid remains so the UI
 * falls back to rendering no chart (matching the opt-in default).
 */
export function validateCharts(params: {
  charts: EvalChartsConfig | undefined;
  columnDefs: ColumnDef[];
  evalId: string;
}): ValidationResult {
  const { charts, columnDefs, evalId } = params;
  if (!charts || charts.length === 0) {
    return { charts: undefined, warnings: [] };
  }
  const columnsByKey = new Map(columnDefs.map((def) => [def.key, def]));
  const warnings: string[] = [];
  const sanitized: EvalChartConfig[] = [];
  for (const chart of charts) {
    const result = sanitizeChart(chart, columnsByKey, evalId, warnings);
    if (result) sanitized.push(result);
  }
  return { charts: sanitized.length > 0 ? sanitized : undefined, warnings };
}
