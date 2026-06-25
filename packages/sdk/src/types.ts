import type {
  EvalCase as SharedEvalCase,
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
  EvalInputSectionConfig,
  EvalInputSectionObjectConfig,
  EvalInputSections,
  EvalInputSectionSelectContext,
  EvalInputSectionSelectFn,
  EvalInputSectionSelector,
  EvalDeriveConfig,
  EvalDeriveContext,
  EvalDeriveFn,
  EvalDeriveMap,
  EvalDeriveValueFn,
  EvalTracingAssertionsConfig,
  EvalTracingAssertionsFn,
  EvalToolCallSpan,
  ColumnFormat,
  EvalStatAggregate,
  EvalStatItem,
  EvalStatsConfig,
  EvalTraceTree,
  DefaultConfigKey,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import type { z } from 'zod';

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
  EvalColumnOverride,
  EvalColumns,
  EvalInputSectionConfig,
  EvalInputSectionObjectConfig,
  EvalInputSections,
  EvalInputSectionSelectContext,
  EvalInputSectionSelectFn,
  EvalInputSectionSelector,
  EvalDeriveConfig,
  EvalDeriveContext,
  EvalDeriveFn,
  EvalDeriveMap,
  EvalDeriveValueFn,
  EvalTracingAssertionsConfig,
  EvalTracingAssertionsFn,
  EvalToolCallSpan,
  ColumnFormat,
  EvalStatAggregate,
  EvalStatItem,
  EvalStatsConfig,
  EvalTraceTree,
  DefaultConfigKey,
};

/**
 * Augment this interface to narrow accepted tag names for direct
 * `@agent-evals/sdk` imports.
 *
 * @example
 * ```ts
 * declare module '@agent-evals/sdk' {
 *   interface AgentEvalTagRegistry {
 *     tags: 'refunds' | 'slow';
 *   }
 * }
 * ```
 */
export interface AgentEvalTagRegistry {
  /** Internal marker so the interface can be safely augmented by users. */
  __agentEvalTagRegistry?: never;
}

/** Tag name accepted by eval definitions, cases, and runtime tag checks. */
export type EvalTag = AgentEvalTagRegistry extends { tags: infer T }
  ? Extract<T, string>
  : string;

/** Typed input accepted by {@link matchesEvalTags}. */
export type EvalTagMatchInput =
  | EvalTag
  | {
      /** Require every listed tag to be present. */
      all?: EvalTag[];
      /** Require at least one listed tag to be present. */
      any?: EvalTag[];
      /** Require every listed tag to be absent. */
      not?: EvalTag[];
    };

/** Single authored eval case with its stable identifier, input, and tags. */
export type EvalCase<TInput = unknown> = Omit<
  SharedEvalCase<TInput>,
  'tags'
> & {
  /** Additional tags applied only to this case. */
  tags?: EvalTag[];
};

/** Runtime output values collected from output helpers and `deriveFromTracing`. */
export type EvalOutputs = Record<string, unknown>;

/**
 * Display options that can be attached directly to one `setOutput(...)` write.
 *
 * Pass a format string such as `'markdown'` for the common case, or an
 * `EvalColumnOverride` when the output also needs a label, numeric formatting,
 * table visibility, alignment, helper description, or star count.
 */
export type EvalOutputOptions = ColumnFormat | EvalColumnOverride;

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
  /**
   * Optional display format or column override for this output. Runtime
   * options are persisted with the case result and are useful when a one-off
   * output should render as Markdown, JSON, media, a number, duration, etc.
   */
  options?: EvalOutputOptions,
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
export type EvalManualScoreDef = Omit<EvalColumnOverride, 'description'> & {
  /**
   * Required review instructions shown alongside the manual score column.
   * Spell out exactly what a human reviewer should inspect before entering
   * the score.
   */
  description: string;
  /**
   * Optional pass/fail gate applied after a value is filled. Pending manual
   * values keep the eval in an `unscored` state instead of failing the case.
   */
  passThreshold?: number;
};

/**
 * Per-field override applied on top of the configuration derived from the
 * eval's `manualInput.schema`. Every property is optional; missing values
 * fall back to whatever the schema-walker inferred.
 */
export type ManualInputFieldOverride = {
  /** Display label rendered next to the field. Defaults to a humanised key. */
  label?: string;
  /** Optional helper text rendered under the label. */
  description?: string;
  /** Optional placeholder rendered inside the input. */
  placeholder?: string;
  /**
   * Force the textarea/multiline widget for a string field. By default a
   * `z.string()` field renders as a single-line text input.
   */
  multiline?: boolean;
  /**
   * Suggested number of visible textarea rows when `multiline` is enabled or
   * the field falls back to the JSON widget. UIs may clamp this value.
   */
  rows?: number;
  /**
   * Force the JSON textarea widget. Use when a field's Zod type is supported
   * natively but you want the raw JSON authoring experience instead.
   */
  asJson?: boolean;
  /**
   * Force the file/image upload widget. The runtime value will be a
   * {@link ManualInputFileValue} carrying the original file name, mime type,
   * size in bytes, content hash, and workspace-relative artifact path. The
   * field's Zod schema should accept that shape — use
   * {@link manualInputFileValueSchema}.
   */
  asFile?: boolean;
  /**
   * Browser `accept` attribute for the file picker (e.g. `image/*`,
   * `image/png,image/jpeg`, `.pdf`). Only used when `asFile` is true.
   */
  accept?: string;
  /**
   * Optional maximum file size in bytes enforced client-side before the value
   * is sent to the server. Only used when `asFile` is true.
   */
  maxSizeBytes?: number;
  /**
   * Override the inferred default value. Useful when the schema has no
   * `.default()` but you want the modal to prefill a starting value.
   */
  defaultValue?: unknown;
  /**
   * Override the inferred select options. Each entry may be a plain string
   * (used as both value and label) or a `{ value, label }` pair.
   */
  options?: Array<string | { value: string; label?: string }>;
};

/**
 * Runtime shape produced by the manual-input file widget. File bytes are
 * persisted as a real workspace-relative artifact so run inputs stay readable
 * and coding agents can inspect uploaded files directly on disk.
 */
export type ManualInputFileValue = {
  /** Original file name as reported by the browser. */
  name: string;
  /** Detected MIME type (`''` when the browser could not determine one). */
  mimeType: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** SHA-256 hash of the persisted file bytes, encoded as lowercase hex. */
  sha256: string;
  /** Workspace-relative path to the persisted file artifact. */
  path: string;
};

/**
 * Per-field override map accepted by `manualInput.fields`. Keys must match a
 * top-level field on the eval's `manualInput.schema` object shape.
 */
export type ManualInputFieldsConfig<TInput> = {
  [K in Extract<keyof TInput, string>]?: ManualInputFieldOverride;
};

/**
 * Manual-input configuration for an eval. When set, every run of the eval
 * pauses on a modal in the web UI (or requires `--input` / `--input-file`
 * in the CLI) until the user submits values matching `schema`. The
 * validated values become the input for a single synthetic case per run.
 *
 * `schema` is bound to the eval's `TInput` generic, so the values delivered
 * to `execute` are end-to-end type-safe. Authoring `cases` and `manualInput`
 * on the same eval is rejected at discovery time.
 */
export type EvalManualInputConfig<TInput> = {
  /** Zod schema describing the user-entered input. Must produce `TInput`. */
  schema: z.ZodType<TInput>;
  /** Optional title shown in the modal header. Defaults to the eval title. */
  title?: string;
  /** Optional helper text rendered above the form. */
  description?: string;
  /** Optional submit button label. Defaults to `Run`. */
  submitLabel?: string;
  /**
   * Optional per-field overrides merged on top of the configuration derived
   * from `schema`. Keys must match a top-level field on the schema's object
   * shape.
   */
  fields?: ManualInputFieldsConfig<TInput>;
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
   * Optional short summary shown in discovery surfaces such as the CLI list and
   * eval cards. Use it to explain the behavior, workflow, or risk area this
   * eval covers.
   */
  description?: string;
  /**
   * Tags applied to every case in this eval, in addition to workspace-wide
   * tags from `agent-evals.config.ts`.
   */
  tags?: EvalTag[];
  /**
   * Workspace-wide tags this eval should not inherit. Each tag must be present
   * in `AgentEvalsConfig.tags`; removing unknown tags is reported during
   * discovery.
   */
  removeTags?: EvalTag[];
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
   *
   * Mutually exclusive with `manualInput`: declaring both raises a discovery
   * issue and prevents the eval from running. Manual-input evals always
   * produce a single synthetic case whose input is the user-submitted value.
   */
  cases?: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>);
  /**
   * Pause every run on a modal in the web UI (or require `--input` /
   * `--input-file` from the CLI) and use the user-submitted, schema-validated
   * value as the case input.
   *
   * Default field configuration is derived from `manualInput.schema`; per
   * field overrides under `manualInput.fields` can replace labels, mark a
   * string field as multiline, override the default value, etc. Mutually
   * exclusive with `cases`.
   */
  manualInput?: EvalManualInputConfig<TInput>;
  /**
   * Output and score column display overrides for this eval.
   *
   * Use this to label, format, group, hide, or otherwise customize columns
   * produced by default config, output helpers, `deriveFromTracing`, scores,
   * or manual scores.
   */
  columns?: EvalColumns;
  /**
   * Highlight important case input values as separate sections in the Input
   * tab. Use a dot selector (`'prompt.data.test'`), a callback
   * (`(input) => value`), or an object with `path` / `select` plus label and
   * format metadata.
   *
   * `file://` URL strings selected by an input section are copied into the run
   * artifacts and rendered as files/media when their extension is supported.
   */
  inputSections?: EvalInputSections<TInput>;
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
   * Freeze the eval Date clock at `startTime` until `evalTime.advance(...)`
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
   * keys not already recorded during execution. Assertion helpers are not
   * allowed here; use `tracingAssertions` for trace-derived pass/fail checks.
   */
  deriveFromTracing?: EvalDeriveConfig<TInput>;
  /**
   * Record assertions from the finished execution trace.
   *
   * Runs after `deriveFromTracing` and before output schema validation and
   * scores. Use `evalAssert(...)` or `evalExpect(...)` inside the callback to
   * write normal assertion results without creating score columns.
   */
  tracingAssertions?: EvalTracingAssertionsConfig<TInput>;
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
   * Built-in kinds (`cases`, `passRate`, `duration`, `cacheHits`) read from
   * the latest run. `duration` aggregates finite per-case durations using the
   * same modes as column stats. `cacheHits` counts Agent Eval operation-level
   * cache hits over total cache operations, not LLM provider prompt-cache read
   * tokens. Cache-hit stats have their own aggregate mode and default to `sum`;
   * `avg` is average per-case hit rate, and min/max/best/worst select cases by
   * hit rate. `kind: 'column'` aggregates a score or numeric output column
   * across the latest run's cases — `key` must match one of the eval's score or
   * column keys, and only finite numeric values participate in the reduction.
   * When no case has a numeric value for the key the stat renders an em dash, or
   * hides when `hideIfNoValue` is true. `label`, `format`, and `numberFormat`
   * default to the matching `ColumnDef`.
   */
  stats?: EvalStatsConfig;
  /**
   * Initial aggregate mode used for this eval's duration and column stats in
   * the web UI.
   *
   * Overrides `AgentEvalsConfig.defaultStatAggregate`. Individual stat
   * `aggregate` values still define their authored reducer and remain the
   * fallback when neither default is configured.
   */
  defaultStatAggregate?: EvalStatAggregate;
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
   * one metric has a numeric value in the rendered history window. Set
   * `dedupeConsecutiveValues` to drop consecutive history points when the
   * chart's plotted metrics and tooltip extras match the previous kept point.
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
