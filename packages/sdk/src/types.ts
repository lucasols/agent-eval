import type {
  ColumnFormat,
  NumberDisplayOptions,
  EvalChartAggregate,
  EvalChartAxis,
  EvalChartBuiltinMetric,
  EvalChartColor,
  EvalChartConfig,
  EvalChartMetric,
  EvalChartsConfig,
  EvalChartTooltipExtra,
  EvalChartType,
  EvalStatAggregate,
  EvalStatItem,
  EvalStatsConfig,
  EvalTraceSpan,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';

export type {
  EvalChartAggregate,
  EvalChartAxis,
  EvalChartBuiltinMetric,
  EvalChartColor,
  EvalChartConfig,
  EvalChartMetric,
  EvalChartsConfig,
  EvalChartTooltipExtra,
  EvalChartType,
  EvalStatAggregate,
  EvalStatItem,
  EvalStatsConfig,
};

/** Single authored eval case with its stable identifier and input payload. */
export type EvalCase<TInput> = { id: string; input: TInput; tags?: string[] };

/** UI overrides for a derived or scored column emitted by an eval. */
export type EvalColumnOverride = {
  /** Display label shown for the column in tables and detail views. */
  label?: string;
  /**
   * Presentation preset for the value.
   *
   * Use this to control how the UI renders the cell and infer table behavior,
   * for example `number`, `boolean`, `duration`, `markdown`, `json`, or
   * file/media previews.
   */
  format?: ColumnFormat;
  /**
   * Extra options for `format: 'number'`.
   *
   * Use this to add a prefix or suffix, force a fixed number of decimal
   * places, or switch to compact notation such as `1.2K`.
   */
  numberFormat?: NumberDisplayOptions;
  /**
   * Hides the column from the runs table while keeping it available in detail
   * views and raw output data.
   */
  hideInTable?: boolean;
  /** Whether the UI should allow sorting rows by this column. */
  sortable?: boolean;
  /** Horizontal alignment used when rendering the column cells. */
  align?: 'left' | 'center' | 'right';
  /**
   * Maximum number of stars used when `format: 'stars'`.
   *
   * Values are still stored as normalized `0..1` numbers; the UI maps the
   * selected star count evenly across that range.
   */
  maxStars?: number;
};

/** Column override map keyed by output or score field name. */
export type EvalColumns = Record<string, EvalColumnOverride>;

/** Query helpers built from the flattened trace recorded for one eval case. */
export type EvalTraceTree = {
  spans: EvalTraceSpan[];
  rootSpans: EvalTraceSpan[];
  findSpan: (name: string) => EvalTraceSpan | undefined;
  findSpansByKind: (kind: EvalTraceSpan['kind']) => EvalTraceSpan[];
  flattenDfs: () => EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
};

/** Context passed to an eval's `execute` function for a single case run. */
export type EvalExecuteContext<TInput> = { input: TInput; signal: AbortSignal };

/** Context passed to `deriveFromTracing` after execution has completed. */
export type EvalDeriveContext<TInput> = {
  trace: EvalTraceTree;
  input: TInput;
  case: EvalCase<TInput>;
};

/** Context passed to score functions after outputs have been collected. */
export type EvalScoreContext<TInput> = {
  input: TInput;
  outputs: Record<string, unknown>;
  case: EvalCase<TInput>;
};

/** Score callback that computes a numeric result for one case. */
export type EvalScoreFn<TInput> = (
  ctx: EvalScoreContext<TInput>,
) => number | Promise<number>;

/**
 * Score definition accepted by `defineEval`, with optional UI metadata.
 *
 * When `passThreshold` is provided, this score gates the case pass/fail:
 * a case fails if its computed value is strictly below the threshold. A
 * score without a `passThreshold` is informational only and never causes
 * a case to fail on its own.
 */
export type EvalScoreDef<TInput> =
  | EvalScoreFn<TInput>
  | ({
      compute: EvalScoreFn<TInput>;
      passThreshold?: number;
    } & EvalColumnOverride);

/**
 * Manual score definition accepted by `defineEval`.
 *
 * Manual scores are emitted as score columns with pending values during CLI
 * execution. The web UI is responsible for setting their normalized `0..1`
 * values after a run completes.
 */
export type EvalManualScoreDef = EvalColumnOverride & {
  /**
   * Optional pass/fail gate applied after a value is filled. Pending manual
   * values keep the eval in an `unscored` state instead of failing the case.
   */
  passThreshold?: number;
};

/** Complete authored eval definition consumed by `defineEval`. */
export type EvalDefinition<TInput = unknown> = {
  id: string;
  title?: string;
  /**
   * Authored cases for this eval.
   *
   * When omitted or resolved to an empty array, the runner still executes the
   * eval once using a synthetic case with empty object input.
   */
  cases?: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>);
  columns?: EvalColumns;
  /**
   * Per-eval trace attribute display rules for the UI.
   *
   * These are merged with the global `AgentEvalsConfig.traceDisplay` rules.
   * Matching entries override the global rule by `key`, or by `path` when no
   * `key` is provided.
   */
  traceDisplay?: TraceDisplayInputConfig;
  execute: (ctx: EvalExecuteContext<TInput>) => Promise<void> | void;
  deriveFromTracing?: (
    ctx: EvalDeriveContext<TInput>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  scores?: Record<string, EvalScoreDef<TInput>>;
  /**
   * Score columns whose values are entered in the web UI after a run.
   *
   * Keys become persisted score columns, initialized as pending (`null`) for
   * every case. Once filled, values are normalized numbers in the `0..1`
   * range and participate in summaries, stats, charts, and pass thresholds
   * like computed scores.
   */
  manualScores?: Record<string, EvalManualScoreDef>;
  /**
   * Optional stats row configuration for the EvalCard in the web UI.
   *
   * Opt-in: when omitted (or empty) the EvalCard renders no stats row at all.
   * When provided, the stats render in order, left to right.
   *
   * Built-in kinds (`cases`, `passRate`, `duration`, `cost`) read from the
   * latest run summary. `kind: 'column'` aggregates a score or numeric output
   * column across the latest run's cases — `key` must match one of the eval's
   * score or column keys, and only finite numeric values participate in the
   * reduction. When no case has a numeric value for the key the stat renders
   * an em dash. `label` and `format` default to the matching `ColumnDef`.
   */
  stats?: EvalStatsConfig;
  /**
   * Optional history chart configuration for the EvalCard in the web UI.
   *
   * Opt-in: when omitted (or empty) the EvalCard renders no history chart at
   * all. Each entry in the list renders as its own chart frame, stacked in
   * authoring order.
   *
   * Each chart declares its `type` (`area | line | bar`) and one or more
   * `metrics`. Built-in metrics (`passRate`, `cost`, `durationMs`) aggregate
   * the run summary. Column metrics aggregate a score or numeric `setEvalOutput`
   * column across the run using an `aggregate` reducer (`avg`, `sum`, `min`,
   * `max`, `latest`, `passThresholdRate`). `passThresholdRate` requires a
   * score column with `passThreshold`.
   */
  charts?: EvalChartsConfig;
};
