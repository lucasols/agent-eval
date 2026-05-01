import type {
  EvalCase,
  EvalChartAggregate,
  EvalChartAxis,
  EvalChartBuiltinMetric,
  EvalChartColor,
  EvalChartConfig,
  EvalChartMetric,
  EvalChartsConfig,
  EvalChartTooltipExtra,
  EvalChartType,
  EvalColumnOverride,
  EvalColumns,
  EvalDeriveConfig,
  EvalDeriveContext,
  EvalDeriveFn,
  EvalDeriveMap,
  EvalDeriveValueFn,
  EvalStatAggregate,
  EvalStatItem,
  EvalStatsConfig,
  EvalTraceTree,
  DefaultConfigKey,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import type { z } from 'zod/v4';

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
  EvalCase,
  EvalColumnOverride,
  EvalColumns,
  EvalDeriveConfig,
  EvalDeriveContext,
  EvalDeriveFn,
  EvalDeriveMap,
  EvalDeriveValueFn,
  EvalStatAggregate,
  EvalStatItem,
  EvalStatsConfig,
  EvalTraceTree,
  DefaultConfigKey,
};

/** Runtime output values collected from output helpers and `deriveFromTracing`. */
export type EvalOutputs = Record<string, unknown>;

/**
 * Initial wall-clock time used by an eval's shifted Date clock.
 *
 * Pass `'now'` to opt one eval back into the real current clock.
 */
export type EvalStartTime = Date | number | string;

/**
 * Schema used to validate and type an eval's collected runtime outputs.
 *
 * Zod schemas are supported directly. The runner validates after `execute` and
 * `deriveFromTracing` finish, before computed scores run.
 */
export type EvalOutputsSchema<TOutputs extends EvalOutputs> =
  z.ZodType<TOutputs>;

/** Per-eval controls for SDK operation caching. */
export type EvalCacheConfig = {
  /**
   * Whether cached spans and value caches may read existing persisted entries.
   *
   * Defaults to `true`. Set to `false` when this eval should always execute
   * cached operations instead of replaying previous results.
   */
  read?: boolean;
  /**
   * Whether cached spans and value caches may persist entries after execution.
   *
   * Defaults to `true`. Set to `false` when this eval may reuse existing cache
   * entries but must not create or refresh stored cache files.
   */
  store?: boolean;
};

/** Type-safe output writer passed to an eval's `execute` function. */
export type EvalSetOutput<TOutputs extends EvalOutputs = EvalOutputs> = <
  TKey extends Extract<keyof TOutputs, string>,
>(
  /**
   * Output field to record. For narrowed output maps, this must be one of the
   * known output keys.
   */
  key: TKey,
  /**
   * Value for the output field. For narrowed output maps, this must match the
   * field's declared output type.
   */
  value: TOutputs[TKey],
) => void;

/** Context passed to an eval's `execute` function for a single case run. */
export type EvalExecuteContext<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
> = {
  /** Authored input for the active eval case. */
  input: TInput;
  /**
   * Record or replace an output value for the current case scope.
   *
   * When the eval has a narrowed outputs generic, keys and values are typed
   * from that output map. The recorded values are still validated by
   * `outputsSchema` before computed scores run.
   */
  setOutput: EvalSetOutput<TOutputs>;
};

/** Context passed to score functions after outputs have been collected. */
export type EvalScoreContext<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
> = { input: TInput; outputs: TOutputs; case: EvalCase<TInput> };

/** Score callback that computes a numeric result for one case. */
export type EvalScoreFn<TInput, TOutputs extends EvalOutputs = EvalOutputs> = (
  ctx: EvalScoreContext<TInput, TOutputs>,
) => number | Promise<number>;

/**
 * Score definition accepted by `defineEval`, with optional UI metadata.
 *
 * When `passThreshold` is provided, this score gates the case pass/fail:
 * a case fails if its computed value is strictly below the threshold. A
 * score without a `passThreshold` is informational only and never causes
 * a case to fail on its own.
 */
export type EvalScoreDef<TInput, TOutputs extends EvalOutputs = EvalOutputs> =
  | EvalScoreFn<TInput, TOutputs>
  | ({
      compute: EvalScoreFn<TInput, TOutputs>;
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

type EvalDefinitionOutputSchemaConfig<TOutputs extends EvalOutputs> = [
  EvalOutputs,
] extends [TOutputs]
  ? {
      /**
       * Optional schema for runtime outputs collected through output helpers
       * and `deriveFromTracing`.
       *
       * The runner validates configured output fields before scoring. For
       * Zod object schemas, only declared keys are passed to the schema;
       * parsed fields are merged back into the raw output map, so schema
       * defaults and transforms apply to configured fields while
       * unconfigured outputs are kept unchanged. Validation failures mark
       * the case as failed and skip computed scores.
       */
      outputsSchema?: EvalOutputsSchema<TOutputs>;
    }
  : {
      /**
       * Required schema for typed runtime outputs collected through output
       * helpers and `deriveFromTracing`.
       *
       * When `EvalDefinition` or `defineEval` receives an explicit narrowed
       * outputs generic, this schema is required so scorer inputs are backed
       * by runtime validation before computed scores run.
       */
      outputsSchema: EvalOutputsSchema<TOutputs>;
    };

type EvalDefinitionBase<
  TInput = unknown,
  TOutputs extends EvalOutputs = EvalOutputs,
> = {
  /**
   * Stable eval identifier within the authored eval file.
   *
   * The runner combines this value with the workspace-relative file path to
   * form the eval key used for targeting, persisted runs, and UI navigation.
   */
  id: string;
  /**
   * Human-readable eval name shown in the CLI and web UI.
   *
   * When omitted, consumers fall back to `id`.
   */
  title?: string;
  /**
   * Per-eval cache controls. Both `read` and `store` default to `true`.
   *
   * `read: false` skips cache lookups for this eval. `store: false` prevents
   * new or refreshed entries from being written while still allowing reads
   * unless `read` is also disabled.
   */
  cache?: EvalCacheConfig;
  /**
   * Authored cases for this eval.
   *
   * When omitted or resolved to an empty array, the runner still executes the
   * eval once using a synthetic case with empty object input.
   */
  cases?: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>);
  /**
   * Output and score column display overrides for this eval.
   *
   * Use this to label, format, group, hide, or otherwise customize columns
   * produced by default config, output helpers, `deriveFromTracing`, scores,
   * or manual scores.
   */
  columns?: EvalColumns;
  /**
   * Per-eval trace attribute display rules for the UI.
   *
   * These are merged with the global `AgentEvalsConfig.traceDisplay` rules.
   * Matching entries override the global rule by `key`, or by `path` when no
   * `key` is provided.
   */
  traceDisplay?: TraceDisplayInputConfig;
  /**
   * Whether registered background jobs should finish before outputs, tracing,
   * and scores are finalized. Defaults to `true`.
   *
   * Set to `false` for evals that intentionally fire work that should not
   * delay case finalization; late mutations are not guaranteed to persist.
   */
  waitForBackgroundJobs?: boolean;
  /**
   * Optional initial wall-clock time for this eval's runtime.
   *
   * When set, `new Date()` and `Date.now()` inside case generation, execution,
   * tracing, derived outputs, and scorers start from this wall-clock value and
   * then continue advancing with real elapsed time. The default is
   * `2026-04-10T00:00:00.000Z`. Pass `'now'` to use the real current clock for
   * this eval. Timers are not faked, so `setTimeout` and other asynchronous
   * work still run normally.
   */
  startTime?: EvalStartTime;
  /**
   * Freeze the eval Date clock at `startTime` until `advanceEvalTime(...)`
   * moves it manually. Defaults to `false`, so eval time advances with real
   * elapsed time from the configured `startTime`.
   */
  freezeTime?: boolean;
  /**
   * Run one eval case.
   *
   * The callback receives the authored case input and a typed `setOutput`
   * helper. It may record outputs, run assertions, start traced work, and
   * return either synchronously or asynchronously. Thrown errors fail the
   * active case and skip later computed scores for that case.
   */
  execute: (ctx: EvalExecuteContext<TInput, TOutputs>) => Promise<void> | void;
  /**
   * Derive additional output fields from the case trace after `execute`.
   *
   * Prefer the keyed map form when each key has one derivation. The
   * object-returning callback form is also supported. Derived values only fill
   * keys not already recorded during execution.
   */
  deriveFromTracing?: EvalDeriveConfig<TInput>;
  /**
   * Computed score columns for each case.
   *
   * Each key becomes a persisted score column. A score can be a bare callback
   * or an object with UI metadata and an optional `passThreshold`; thresholds
   * fail a case only when the computed value is strictly below the threshold.
   */
  scores?: Record<string, EvalScoreDef<TInput, TOutputs>>;
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
   * an em dash, or hides when `hideIfNoValue` is true. `label`, `format`, and
   * `numberFormat` default to the matching `ColumnDef`.
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
   * `metrics`. Built-in metrics (`passRate`, `durationMs`) aggregate
   * the run summary. Column metrics aggregate a score or numeric output column
   * across the run using an `aggregate` reducer (`avg`, `sum`, `min`, `max`,
   * `latest`, `passThresholdRate`). `passThresholdRate` requires a score column
   * with `passThreshold`. Set `hideIfNoValue` to hide a chart until at least
   * one metric has a numeric value in the rendered history window.
   */
  charts?: EvalChartsConfig;
  /**
   * Remove built-in eval-level outputs, columns, stats, and charts.
   *
   * By default the runner derives usage fields from trace spans using the
   * workspace `llmCalls` and `apiCalls` configs. Set to `true` to remove all
   * defaults for this eval, or pass specific keys such as
   * `['costUsd', 'apiCalls']` to remove only those defaults. Per-eval removals
   * are combined with global removals.
   */
  removeDefaultConfig?: true | DefaultConfigKey[];
};

/**
 * Complete authored eval definition consumed by `defineEval`.
 *
 * `outputsSchema` is optional for the default loose output map. When the
 * `TOutputs` generic is narrowed, `outputsSchema` is required so the runtime
 * validates collected outputs before exposing them as typed scorer inputs.
 */
export type EvalDefinition<
  TInput = unknown,
  TOutputs extends EvalOutputs = EvalOutputs,
> = EvalDefinitionBase<TInput, TOutputs> &
  EvalDefinitionOutputSchemaConfig<TOutputs>;
