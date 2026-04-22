import { z } from 'zod/v4';

/** Chart type rendered for a single eval history chart. */
export const evalChartTypeSchema = z.enum(['area', 'line', 'bar']);
/** Chart type rendered for a single eval history chart. */
export type EvalChartType = z.infer<typeof evalChartTypeSchema>;

/**
 * Run-level metric sourced from the aggregated `RunSummary` for a run, rather
 * than from a per-case column.
 */
export const evalChartBuiltinMetricSchema = z.enum([
  'passRate',
  'cost',
  'durationMs',
]);
/**
 * Run-level metric sourced from the aggregated `RunSummary` for a run, rather
 * than from a per-case column.
 */
export type EvalChartBuiltinMetric = z.infer<
  typeof evalChartBuiltinMetricSchema
>;

/** Reducer applied to a numeric column across all cases of a single run. */
export const evalChartAggregateSchema = z.enum([
  'avg',
  'sum',
  'min',
  'max',
  'latest',
  'passThresholdRate',
]);
/** Reducer applied to a numeric column across all cases of a single run. */
export type EvalChartAggregate = z.infer<typeof evalChartAggregateSchema>;

/**
 * Semantic color token resolved to a theme color by the web UI. The SDK does
 * not emit raw hex so authored evals stay decoupled from the web theme.
 */
export const evalChartColorSchema = z.enum([
  'accent',
  'accentDim',
  'success',
  'error',
  'warning',
  'cost',
  'textMuted',
]);
/** Semantic color token resolved to a theme color by the web UI. */
export type EvalChartColor = z.infer<typeof evalChartColorSchema>;

/** Y-axis placement for a plotted series on a dual-axis chart. */
export const evalChartAxisSchema = z.enum(['left', 'right']);
/** Y-axis placement for a plotted series on a dual-axis chart. */
export type EvalChartAxis = z.infer<typeof evalChartAxisSchema>;

/**
 * One plotted series on an eval history chart. `builtin` metrics come from the
 * per-run `RunSummary`; `column` metrics aggregate a per-case score or
 * `setOutput` column across the run using `aggregate`.
 */
export const evalChartMetricSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('builtin'),
    metric: evalChartBuiltinMetricSchema,
    label: z.string().optional(),
    color: evalChartColorSchema.optional(),
    axis: evalChartAxisSchema.optional(),
  }),
  z.object({
    source: z.literal('column'),
    /** Matches a declared score key or a `setOutput` key on the eval. */
    key: z.string().min(1),
    aggregate: evalChartAggregateSchema,
    label: z.string().optional(),
    color: evalChartColorSchema.optional(),
    axis: evalChartAxisSchema.optional(),
  }),
]);
/** One plotted series on an eval history chart. */
export type EvalChartMetric = z.infer<typeof evalChartMetricSchema>;

/** Extra field rendered only in the tooltip, not plotted as a series. */
export const evalChartTooltipExtraSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('builtin'),
    metric: evalChartBuiltinMetricSchema,
    label: z.string().optional(),
  }),
  z.object({
    source: z.literal('column'),
    key: z.string().min(1),
    aggregate: evalChartAggregateSchema,
    label: z.string().optional(),
  }),
]);
/** Extra field rendered only in the tooltip, not plotted as a series. */
export type EvalChartTooltipExtra = z.infer<typeof evalChartTooltipExtraSchema>;

/**
 * Authored configuration for one eval history chart rendered in `EvalCard`.
 * Authors declare a list of these via `EvalDefinition.charts` — the UI renders
 * each entry as its own chart frame, stacked in authoring order.
 */
export const evalChartConfigSchema = z.object({
  /** Optional heading shown above the chart frame in the UI. */
  heading: z.string().optional(),
  type: evalChartTypeSchema,
  /** At least one series must be declared. */
  metrics: z.array(evalChartMetricSchema).min(1),
  /**
   * Per-axis Y domain. Omit either side for automatic scaling. When unset the
   * chart auto-scales — there is no implicit `[0, 1]` clamp.
   */
  yDomain: z
    .object({
      left: z
        .object({ min: z.number().optional(), max: z.number().optional() })
        .optional(),
      right: z
        .object({ min: z.number().optional(), max: z.number().optional() })
        .optional(),
    })
    .optional(),
  tooltipExtras: z.array(evalChartTooltipExtraSchema).optional(),
});
/** Authored configuration for one eval history chart. */
export type EvalChartConfig = z.infer<typeof evalChartConfigSchema>;

/**
 * Ordered list of history charts rendered for an eval. Opt-in: when omitted or
 * empty, the UI renders no history chart at all.
 */
export const evalChartsConfigSchema = z.array(evalChartConfigSchema);
/** Ordered list of history charts rendered for an eval. */
export type EvalChartsConfig = z.infer<typeof evalChartsConfigSchema>;
