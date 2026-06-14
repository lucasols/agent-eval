import { z } from 'zod';
import {
  columnFormatSchema,
  numberDisplayOptionsSchema,
  type ColumnFormat,
  type NumberDisplayOptions,
} from './display.ts';
import {
  evalStatAggregateSchema,
  evalStatsConfigSchema,
  type EvalStatAggregate,
  type EvalStatsConfig,
} from './eval.ts';
import {
  traceDisplayInputConfigSchema,
  type EvalTraceSpan,
  type TraceDisplayInputConfig,
} from './trace.ts';

/** Strategy used to collapse repeated trials into one stored case result. */
export const trialSelectionModeSchema = z.enum(['lowestScore', 'median']);
/** Strategy used to collapse repeated trials into one stored case result. */
export type TrialSelectionMode = z.infer<typeof trialSelectionModeSchema>;

/**
 * Built-in eval-level output/column keys.
 *
 * `costUsd` controls the default LLM cost family: actual billed cost plus the
 * normalized `costUsdWithoutCache` and `costUsdWarmedCache` chart outputs.
 */
export const defaultConfigKeySchema = z.enum([
  'apiCalls',
  'costUsd',
  'llmTurns',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'reasoningTokens',
  'llmDurationMs',
]);
/** Built-in eval-level output/column key. */
export type DefaultConfigKey = z.infer<typeof defaultConfigKeySchema>;

/** Removal config for built-in eval-level outputs and UI metadata. */
export const removeDefaultConfigSchema = z.union([
  z.literal(true),
  z.array(defaultConfigKeySchema),
]);
/** Removal config for built-in eval-level outputs and UI metadata. */
export type RemoveDefaultConfig = z.infer<typeof removeDefaultConfigSchema>;

/** Single authored eval case with its stable identifier and input payload. */
export type EvalCase<TInput = unknown> = {
  id: string;
  input: TInput;
  tags?: string[];
};

/** Normalized view of one tool-call span and its common tool metadata. */
export type EvalToolCallSpan = {
  /** Preferred tool name, using GenAI/Mastra identity metadata when present. */
  name: string;
  /** Original trace span display name. */
  spanName: string;
  /** Original trace span kind. */
  kind: string;
  /** Parsed tool-call arguments, or the raw value when parsing is not possible. */
  arguments: unknown;
  /** Parsed tool-call result, or the raw value when parsing is not possible. */
  result: unknown;
  /** Tool description from GenAI/Mastra metadata when present. */
  description: string | undefined;
  /** Tool type from GenAI/Mastra metadata when present. */
  toolType: string | undefined;
  /** Original span attributes. */
  attributes: Record<string, unknown> | undefined;
  /** Original trace span for fields not normalized above. */
  span: EvalTraceSpan;
};

/** Query helpers built from the flattened trace recorded for one eval case. */
export type EvalTraceTree = {
  /** Flat span list in creation order. */
  spans: EvalTraceSpan[];
  /** Top-level spans whose `parentId` is `null`. */
  rootSpans: EvalTraceSpan[];
  /** Return the first span whose name exactly matches `name`. */
  findSpan: (name: string) => EvalTraceSpan | undefined;
  /** Return every span whose name exactly matches `name`. */
  findSpans: (name: string) => EvalTraceSpan[];
  /** Return whether any span name exactly matches `name`. */
  hasSpan: (name: string) => boolean;
  /** Return every span whose kind exactly matches `kind`. */
  findSpansByKind: (kind: string) => EvalTraceSpan[];
  /** Return every span with `kind: 'tool'` or `kind: 'tool_call'`. */
  findToolCallSpans: () => EvalTraceSpan[];
  /**
   * Return tool-call names, preferring GenAI/Mastra tool identity attributes
   * when available.
   */
  listToolCallSpanNames: () => string[];
  /** Return whether a tool-call span name or tool identity matches `name`. */
  hasToolCallSpan: (name: string) => boolean;
  /** Return normalized tool-call spans whose name or tool identity matches `name`. */
  getToolCallSpans: (name: string) => EvalToolCallSpan[];
  /** Return how many tool-call spans have a name or tool identity matching `toolName`. */
  getToolCallSpanCount: (toolName: string) => number;
  /** Return whether a tool-call span name or tool identity appears exactly `expectedCalls` times. */
  hasToolCallSpanCount: (toolName: string, expectedCalls: number) => boolean;
  /** Return span names in creation order, optionally filtered by kind. */
  listSpanNames: (kind?: string) => string[];
  /** Return span names in depth-first tree order, optionally filtered by kind. */
  listSpanNamesDfs: (kind?: string) => string[];
  /** Return all spans in depth-first tree order. */
  flattenDfs: () => EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
};

/** Context passed to `deriveFromTracing` after execution has completed. */
export type EvalDeriveContext<TInput = unknown> = {
  trace: EvalTraceTree;
  input: TInput;
  case: EvalCase<TInput>;
};

type MaybePromise<T> = T | Promise<T>;

/** Function that derives one output value for a configured output key. */
export type EvalDeriveValueFn<TInput = unknown> = (
  ctx: EvalDeriveContext<TInput>,
) => MaybePromise<unknown>;

/** Keyed `deriveFromTracing` config where each key derives one output value. */
export type EvalDeriveMap<TInput = unknown> = Record<
  string,
  EvalDeriveValueFn<TInput>
>;

/** Object-returning `deriveFromTracing` callback. */
export type EvalDeriveFn<TInput = unknown> = (
  ctx: EvalDeriveContext<TInput>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/** Trace-derived output config accepted globally and on eval definitions. */
export type EvalDeriveConfig<TInput = unknown> =
  | EvalDeriveMap<TInput>
  | EvalDeriveFn<TInput>;

const evalDeriveValueFnSchema = z.custom<EvalDeriveValueFn>(
  (value) => typeof value === 'function',
  { message: 'Expected a derive output function' },
);

/** Schema for keyed or object-returning trace-derived output config. */
export const evalDeriveConfigSchema: z.ZodType<EvalDeriveConfig> = z.union([
  z.custom<EvalDeriveFn>((value) => typeof value === 'function', {
    message: 'Expected a deriveFromTracing function',
  }),
  z.record(z.string().min(1), evalDeriveValueFnSchema),
]);

/** Function that records trace-derived assertions for one case. */
export type EvalTracingAssertionsFn<TInput = unknown> = (
  ctx: EvalDeriveContext<TInput>,
) => MaybePromise<void>;

/** Trace-derived assertion config accepted globally and on eval definitions. */
export type EvalTracingAssertionsConfig<TInput = unknown> =
  EvalTracingAssertionsFn<TInput>;

/** Schema for trace-derived assertion config. */
export const evalTracingAssertionsConfigSchema: z.ZodType<EvalTracingAssertionsConfig> =
  z.custom<EvalTracingAssertionsFn>((value) => typeof value === 'function', {
    message: 'Expected a tracingAssertions function',
  });

/** UI overrides for a derived or scored column emitted by an eval. */
export type EvalColumnOverride = {
  /** Display label shown for the column in tables and detail views. */
  label?: string;
  /**
   * Presentation preset for the value.
   *
   * Use this to control how the UI renders the cell and infer table behavior,
   * for example `number`, `boolean`, `duration`, `markdown`, `json`,
   * `image`, `html`, `pdf`, or file/media previews.
   */
  format?: ColumnFormat;
  /**
   * Extra options for `format: 'number'`.
   *
   * Use this to add a prefix or suffix, control minimum and maximum decimal
   * places, or switch to compact notation such as `1.2K`.
   */
  numberFormat?: NumberDisplayOptions;
  /**
   * Hides the column from the runs table while keeping it available in detail
   * views and raw output data.
   */
  hideInTable?: boolean;
  /**
   * Hides the column from the runs table when none of the rendered rows have a
   * value. Missing values, `null`, and empty strings count as no value; `0` and
   * `false` remain visible.
   */
  hideIfNoValue?: boolean;
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

/** Schema for UI overrides on derived or scored columns. */
export const evalColumnOverrideSchema: z.ZodType<EvalColumnOverride> = z.object(
  {
    label: z.string().optional(),
    format: columnFormatSchema.optional(),
    numberFormat: numberDisplayOptionsSchema.optional(),
    hideInTable: z.boolean().optional(),
    hideIfNoValue: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    maxStars: z.number().int().min(2).optional(),
  },
);

/** Schema for column override maps keyed by output or score field name. */
export const evalColumnsSchema: z.ZodType<EvalColumns> = z.record(
  z.string(),
  evalColumnOverrideSchema,
);

/** Render formats supported by an LLM-call metric in the UI. */
export const llmCallMetricFormatSchema = z.enum([
  'string',
  'number',
  'duration',
  'json',
  'boolean',
]);
/** Render format applied to an LLM-call metric value. */
export type LlmCallMetricFormat = z.infer<typeof llmCallMetricFormatSchema>;

/** Render formats supported by an API-call metric in the UI. */
export const apiCallMetricFormatSchema = llmCallMetricFormatSchema;
/** Render format applied to an API-call metric value. */
export type ApiCallMetricFormat = z.infer<typeof apiCallMetricFormatSchema>;

/** Where an LLM-call metric is rendered inside the LLM calls tab. */
export const llmCallMetricPlacementSchema = z.enum(['header', 'body']);
/** Placement option for an LLM-call metric. */
export type LlmCallMetricPlacement = z.infer<
  typeof llmCallMetricPlacementSchema
>;

/** Where an API-call metric is rendered inside the API calls tab. */
export const apiCallMetricPlacementSchema = llmCallMetricPlacementSchema;
/** Placement option for an API-call metric. */
export type ApiCallMetricPlacement = z.infer<
  typeof apiCallMetricPlacementSchema
>;

/** Context passed to LLM/API-call derived attribute functions. */
export type CallDerivedAttributeContext = {
  /** Current attributes from the matching trace span. */
  attributes: Record<string, unknown> | undefined;
  /** Matching trace span. */
  span: EvalTraceSpan;
  /** Dot-path helper for reading from the current span attributes. */
  get: (path: string) => unknown;
};

/**
 * Runner-side function used to derive one new span attribute from a matching
 * LLM/API-call span. Return `undefined` to omit the attribute for that span.
 */
export type CallDerivedAttribute = (
  ctx: CallDerivedAttributeContext,
) => unknown;

/**
 * Runner-side function used to derive multiple span attributes from a matching
 * LLM/API-call span. Returned object keys are dot-paths under
 * `span.attributes`; `undefined` values are skipped.
 */
export type CallDerivedAttributesFn = (
  ctx: CallDerivedAttributeContext,
) => Record<string, unknown> | undefined;

/** Authored LLM/API-call derived-attributes config. */
export type CallDerivedAttributesConfig =
  | Record<string, CallDerivedAttribute>
  | CallDerivedAttributesFn;

const callDerivedAttributeSchema = z.custom<CallDerivedAttribute>(
  (value) => typeof value === 'function',
  { message: 'Expected a derived attribute function' },
);

const callDerivedAttributesFnSchema = z.custom<CallDerivedAttributesFn>(
  (value) => typeof value === 'function',
  { message: 'Expected a derived attributes function' },
);

const callDerivedAttributesConfigSchema: z.ZodType<CallDerivedAttributesConfig> =
  z.union([
    z.record(z.string().min(1), callDerivedAttributeSchema),
    callDerivedAttributesFnSchema,
  ]);

/** One resolved derived span attribute rule. */
export type ResolvedCallDerivedAttribute = {
  /** Dot-path where one derived value is persisted on `span.attributes`. */
  path?: string;
  /**
   * Function that derives one persisted value for each matching span. Omitted
   * after this config is serialized to the browser.
   */
  compute?: CallDerivedAttribute;
  /**
   * Function that derives multiple persisted values for each matching span.
   * Omitted after this config is serialized to the browser.
   */
  computeMany?: CallDerivedAttributesFn;
};

/**
 * Schema for a single user-defined metric attached to LLM call rows.
 *
 * Each metric reads `path` from the span's `attributes` and renders the value
 * with the configured `format` and `numberFormat`. Use
 * `llmCalls.derivedAttributes` when a metric should read a value computed from
 * other attributes. `placements` controls whether the metric appears as a chip
 * on the collapsed row header, as a row inside the expanded body, or both.
 * Defaults to `['body']` when omitted.
 */
export const llmCallMetricSchema = z.object({
  /** Display label for the metric row or header chip. */
  label: z.string().min(1),
  /**
   * Optional hover tooltip shown on the metric. Useful when `label` is a
   * compact abbreviation (e.g. `'t/s'`) and the full meaning needs to be
   * surfaced on hover (e.g. `'Tokens per second'`).
   */
  tooltip: z.string().min(1).optional(),
  /** Dot-path inside `span.attributes` used to read the value. */
  path: z.string().min(1),
  /** Render hint applied to the resolved value. Defaults to `'string'`. */
  format: llmCallMetricFormatSchema.optional(),
  /** Number presentation options applied when `format: 'number'`. */
  numberFormat: numberDisplayOptionsSchema.optional(),
  /**
   * Where the metric should appear in the LLM calls tab. Defaults to
   * `['body']` so metrics surface inside the expanded detail view only.
   */
  placements: z.array(llmCallMetricPlacementSchema).nonempty().optional(),
});
/** User-defined metric authored in `agent-evals.config.ts`. */
export type LlmCallMetric = z.infer<typeof llmCallMetricSchema>;

/**
 * Schema for a single user-defined metric attached to API call rows.
 *
 * Each metric reads `path` from the span's `attributes` and renders the value
 * with the configured `format` and `numberFormat`. Use
 * `apiCalls.derivedAttributes` when a metric should read a value computed from
 * other attributes. `placements` controls whether the metric appears as a chip
 * on the collapsed row header, as a row inside the expanded body, or both.
 * Defaults to `['body']` when omitted.
 */
export const apiCallMetricSchema = z.object({
  /** Display label for the metric row or header chip. */
  label: z.string().min(1),
  /**
   * Optional hover tooltip shown on the metric. Useful when `label` is a
   * compact abbreviation and the full meaning needs to be surfaced on hover.
   */
  tooltip: z.string().min(1).optional(),
  /** Dot-path inside `span.attributes` used to read the value. */
  path: z.string().min(1),
  /** Render hint applied to the resolved value. Defaults to `'string'`. */
  format: apiCallMetricFormatSchema.optional(),
  /** Number presentation options applied when `format: 'number'`. */
  numberFormat: numberDisplayOptionsSchema.optional(),
  /**
   * Where the metric should appear in the API calls tab. Defaults to
   * `['body']` so metrics surface inside the expanded detail view only.
   */
  placements: z.array(apiCallMetricPlacementSchema).nonempty().optional(),
});
/** User-defined API-call metric authored in `agent-evals.config.ts`. */
export type ApiCallMetric = z.infer<typeof apiCallMetricSchema>;

/**
 * Schema for pricing rates used to derive LLM-call costs from token counts.
 */
export const llmCallPricingRateSchema = z.object({
  /** USD per one million non-cached input tokens. */
  inputUsdPerMillion: z.number().nonnegative().optional(),
  /** USD per one million output tokens. */
  outputUsdPerMillion: z.number().nonnegative().optional(),
  /** USD per one million prompt-cache read tokens. */
  cachedInputUsdPerMillion: z.number().nonnegative().optional(),
  /** USD per one million prompt-cache write tokens. */
  cacheCreationInputUsdPerMillion: z.number().nonnegative().optional(),
  /** USD per one million one-hour prompt-cache write tokens. */
  cacheCreationInput1hUsdPerMillion: z.number().nonnegative().optional(),
  /** USD per one million reasoning tokens when reported separately. */
  reasoningUsdPerMillion: z.number().nonnegative().optional(),
});

/** Token pricing rates authored in `agent-evals.config.ts`. */
export type LlmCallPricingRate = z.infer<typeof llmCallPricingRateSchema>;

/**
 * Schema for one model's pricing config. The object key is the exact model
 * name. Use `providers` when a model has provider-specific rates in addition
 * to, or instead of, generic model rates.
 */
export const llmCallPricingSchema = llmCallPricingRateSchema.extend({
  /**
   * Optional provider discriminator read from `attributes.provider`. When set,
   * the top-level entry only applies to calls from that provider.
   */
  provider: z.string().min(1).optional(),
  /**
   * Provider-specific pricing for the model. Provider entries take precedence
   * over generic rates for the same model.
   */
  providers: z.record(z.string().min(1), llmCallPricingRateSchema).optional(),
});
/** Model pricing config authored in `agent-evals.config.ts`. */
export type LlmCallPricing = z.infer<typeof llmCallPricingSchema>;

/** Model-keyed pricing registry authored in `agent-evals.config.ts`. */
export type LlmCallPricingRegistry = Record<string, LlmCallPricing>;

/**
 * Schema for extra currencies displayed in the LLM calls breakdown table.
 * Costs are still derived in USD, then multiplied by `usdToCurrencyRate`.
 */
export const llmCallCostCurrencySchema = z.object({
  /** Currency code or short display token, such as `BRL` or `EUR`. */
  code: z.string().min(1),
  /** Optional display label for tooltips and future UI surfaces. */
  label: z.string().min(1).optional(),
  /** Multiplier used to convert one USD to this currency. */
  usdToCurrencyRate: z.number().nonnegative(),
  /** Number presentation options for the converted value. */
  numberFormat: numberDisplayOptionsSchema.optional(),
});

/** Extra LLM-call cost currency authored in `agent-evals.config.ts`. */
export type LlmCallCostCurrency = z.infer<typeof llmCallCostCurrencySchema>;

/** Schema for the global LLM calls config block in `agent-evals.config.ts`. */
export const llmCallsConfigSchema = z.object({
  /** Span kinds treated as LLM calls. Defaults to `['llm']`. */
  kinds: z.array(z.string().min(1)).optional(),
  /**
   * Attribute paths used to extract structured per-call fields. Each entry is
   * a dot-path inside `span.attributes`. Missing paths fall back to the
   * built-in defaults (e.g. `usage.inputTokens`). Derived fields such as
   * total tokens, tokens/sec, duration, and USD costs are intentionally not
   * configurable as attribute paths.
   */
  attributes: z
    .object({
      model: z.string().optional(),
      provider: z.string().optional(),
      inputTokens: z.string().optional(),
      outputTokens: z.string().optional(),
      cachedInputTokens: z.string().optional(),
      cacheCreationInputTokens: z.string().optional(),
      cacheCreationInput1hTokens: z.string().optional(),
      reasoningTokens: z.string().optional(),
      latencyMs: z.string().optional(),
      steps: z.string().optional(),
      finishReason: z.string().optional(),
      input: z.string().optional(),
      output: z.string().optional(),
      reasoning: z.string().optional(),
      toolCalls: z.string().optional(),
    })
    .optional(),
  /**
   * Derived attributes persisted onto every matching LLM span before
   * `deriveFromTracing`, default outputs, trace display, and call metrics read
   * the trace. Use a keyed map for one-off fields, or one callback returning a
   * path/value object for multiple fields. Keys are dot-paths under
   * `span.attributes`; return `undefined` to skip one span or one returned key.
   */
  derivedAttributes: callDerivedAttributesConfigSchema.optional(),
  /**
   * Model-keyed pricing registry used to calculate LLM-call costs from token
   * counts. Built-in LLM cost fields are only derived from this registry.
   */
  pricing: z.record(z.string().min(1), llmCallPricingSchema).optional(),
  /**
   * Additional currencies shown as columns in the LLM calls breakdown table.
   * These do not change persisted `costUsd` outputs, stats, or charts.
   */
  costCurrencies: z.array(llmCallCostCurrencySchema).optional(),
  /** Custom user-defined metrics surfaced on each LLM call. */
  metrics: z.array(llmCallMetricSchema).optional(),
});
/** Authored LLM calls config accepted from `agent-evals.config.ts`. */
export type LlmCallsConfigInput = z.infer<typeof llmCallsConfigSchema>;

/** Schema for the global API calls config block in `agent-evals.config.ts`. */
export const apiCallsConfigSchema = z.object({
  /** Span kinds treated as API calls. Defaults to common API/HTTP kinds. */
  kinds: z.array(z.string().min(1)).optional(),
  /**
   * Attribute paths used to extract structured per-call fields. Each entry is
   * a dot-path inside `span.attributes`. Missing paths fall back to the
   * built-in defaults such as `method`, `url`, and `statusCode`.
   */
  attributes: z
    .object({
      method: z.string().optional(),
      url: z.string().optional(),
      routeAlias: z.string().optional(),
      statusCode: z.string().optional(),
      request: z.string().optional(),
      response: z.string().optional(),
      requestBody: z.string().optional(),
      responseBody: z.string().optional(),
      headers: z.string().optional(),
      durationMs: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  /**
   * Derived attributes persisted onto every matching API span before trace
   * display and call metrics read the trace. Use a keyed map for one-off
   * fields, or one callback returning a path/value object for multiple fields.
   * Keys are dot-paths under `span.attributes`; return `undefined` to skip one
   * span or one returned key.
   */
  derivedAttributes: callDerivedAttributesConfigSchema.optional(),
  /** Custom user-defined metrics surfaced on each API call. */
  metrics: z.array(apiCallMetricSchema).optional(),
});
/** Authored API calls config accepted from `agent-evals.config.ts`. */
export type ApiCallsConfigInput = z.infer<typeof apiCallsConfigSchema>;

/** Schema for workspace-level run log capture options. */
export const runLogsConfigSchema = z.object({
  /**
   * Capture `console.log`, `console.info`, `console.warn`, and
   * `console.error` calls made inside active eval case scopes. Defaults to
   * `true`; manual `evalLog(...)` calls are always captured.
   */
  captureConsole: z.boolean().optional(),
});
/** Workspace-level run log capture options. */
export type RunLogsConfigInput = z.infer<typeof runLogsConfigSchema>;

/** Resolved LLM-calls config sent to the UI with all defaults applied. */
export type ResolvedLlmCallsConfig = {
  kinds: string[];
  attributes: {
    model: string;
    provider: string;
    inputTokens: string;
    outputTokens: string;
    cachedInputTokens: string;
    cacheCreationInputTokens: string;
    cacheCreationInput1hTokens: string;
    reasoningTokens: string;
    latencyMs: string;
    steps: string;
    finishReason: string;
    input: string;
    output: string;
    reasoning: string;
    toolCalls: string;
  };
  derivedAttributes: ResolvedCallDerivedAttribute[];
  metrics: ResolvedLlmCallMetric[];
  pricing: ResolvedLlmCallPricing[];
  costCurrencies: ResolvedLlmCallCostCurrency[];
};

/** Resolved API-calls config sent to the UI with all defaults applied. */
export type ResolvedApiCallsConfig = {
  kinds: string[];
  attributes: {
    method: string;
    url: string;
    routeAlias: string;
    statusCode: string;
    request: string;
    response: string;
    requestBody: string;
    responseBody: string;
    headers: string;
    durationMs: string;
    error: string;
  };
  derivedAttributes: ResolvedCallDerivedAttribute[];
  metrics: ResolvedApiCallMetric[];
};

/** Fully-resolved LLM-call metric used by the runner and UI. */
export type ResolvedLlmCallMetric = {
  label: string;
  tooltip?: string;
  path: string;
  format: LlmCallMetricFormat;
  numberFormat?: NumberDisplayOptions;
  placements: LlmCallMetricPlacement[];
};

/** Fully-resolved API-call metric used by the runner and UI. */
export type ResolvedApiCallMetric = {
  label: string;
  tooltip?: string;
  path: string;
  format: ApiCallMetricFormat;
  numberFormat?: NumberDisplayOptions;
  placements: ApiCallMetricPlacement[];
};

/** Fully-resolved pricing entry used by the LLM calls extractor. */
export type ResolvedLlmCallPricing = {
  model: string;
  provider?: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  cacheCreationInputUsdPerMillion?: number;
  cacheCreationInput1hUsdPerMillion?: number;
  reasoningUsdPerMillion?: number;
};

/** Fully-resolved extra currency used by the LLM calls tab. */
export type ResolvedLlmCallCostCurrency = {
  code: string;
  label?: string;
  usdToCurrencyRate: number;
  numberFormat?: NumberDisplayOptions;
};

/** Default LLM-calls config the UI uses before the workspace fetch resolves. */
export const DEFAULT_LLM_CALLS_CONFIG: ResolvedLlmCallsConfig = {
  kinds: ['llm'],
  attributes: {
    model: 'model',
    provider: 'provider',
    inputTokens: 'usage.inputTokens',
    outputTokens: 'usage.outputTokens',
    cachedInputTokens: 'usage.cachedInputTokens',
    cacheCreationInputTokens: 'usage.cacheCreationInputTokens',
    cacheCreationInput1hTokens: 'usage.cacheCreationInput1hTokens',
    reasoningTokens: 'usage.reasoningTokens',
    latencyMs: 'latencyMs',
    steps: 'steps',
    finishReason: 'finishReason',
    input: 'input',
    output: 'output',
    reasoning: 'reasoning',
    toolCalls: 'toolCalls',
  },
  derivedAttributes: [],
  metrics: [],
  pricing: [],
  costCurrencies: [],
};

/** Default API-calls config the UI uses before the workspace fetch resolves. */
export const DEFAULT_API_CALLS_CONFIG: ResolvedApiCallsConfig = {
  kinds: ['api', 'http', 'http.client', 'fetch'],
  attributes: {
    method: 'method',
    url: 'url',
    routeAlias: 'routeAlias',
    statusCode: 'statusCode',
    request: 'request',
    response: 'response',
    requestBody: 'requestBody',
    responseBody: 'responseBody',
    headers: 'headers',
    durationMs: 'durationMs',
    error: 'error',
  },
  derivedAttributes: [],
  metrics: [],
};

function resolveDerivedAttributes(
  input: CallDerivedAttributesConfig | undefined,
): ResolvedCallDerivedAttribute[] {
  if (input === undefined) return [];
  if (typeof input === 'function') return [{ computeMany: input }];
  return Object.entries(input).map(([path, compute]) => ({ path, compute }));
}

function resolveLlmCallMetric(metric: LlmCallMetric): ResolvedLlmCallMetric {
  return {
    label: metric.label,
    tooltip: metric.tooltip,
    path: metric.path,
    format: metric.format ?? 'string',
    numberFormat: metric.numberFormat,
    placements: metric.placements ? [...metric.placements] : ['body'],
  };
}

function resolveApiCallMetric(metric: ApiCallMetric): ResolvedApiCallMetric {
  return {
    label: metric.label,
    tooltip: metric.tooltip,
    path: metric.path,
    format: metric.format ?? 'string',
    numberFormat: metric.numberFormat,
    placements: metric.placements ? [...metric.placements] : ['body'],
  };
}

function hasPricingRates(pricing: LlmCallPricingRate): boolean {
  return (
    pricing.inputUsdPerMillion !== undefined ||
    pricing.outputUsdPerMillion !== undefined ||
    pricing.cachedInputUsdPerMillion !== undefined ||
    pricing.cacheCreationInputUsdPerMillion !== undefined ||
    pricing.cacheCreationInput1hUsdPerMillion !== undefined ||
    pricing.reasoningUsdPerMillion !== undefined
  );
}

function copyPricingRates(
  pricing: LlmCallPricingRate,
): Omit<ResolvedLlmCallPricing, 'model' | 'provider'> {
  return {
    inputUsdPerMillion: pricing.inputUsdPerMillion,
    outputUsdPerMillion: pricing.outputUsdPerMillion,
    cachedInputUsdPerMillion: pricing.cachedInputUsdPerMillion,
    cacheCreationInputUsdPerMillion: pricing.cacheCreationInputUsdPerMillion,
    cacheCreationInput1hUsdPerMillion:
      pricing.cacheCreationInput1hUsdPerMillion,
    reasoningUsdPerMillion: pricing.reasoningUsdPerMillion,
  };
}

function resolveLlmCallPricingEntries(
  model: string,
  pricing: LlmCallPricing,
): ResolvedLlmCallPricing[] {
  const entries: ResolvedLlmCallPricing[] = [];

  if (hasPricingRates(pricing)) {
    entries.push({
      model,
      provider: pricing.provider,
      ...copyPricingRates(pricing),
    });
  }

  for (const [provider, providerPricing] of Object.entries(
    pricing.providers ?? {},
  )) {
    entries.push({ model, provider, ...copyPricingRates(providerPricing) });
  }

  return entries;
}

function resolveLlmCallCostCurrency(
  currency: LlmCallCostCurrency,
): ResolvedLlmCallCostCurrency {
  return {
    code: currency.code,
    label: currency.label,
    usdToCurrencyRate: currency.usdToCurrencyRate,
    numberFormat: currency.numberFormat,
  };
}

/**
 * Resolve the user-authored LLM-calls config to a fully-defaulted shape used
 * by the UI to derive the LLM calls tab.
 *
 * - Missing or empty `kinds` falls back to `['llm']`.
 * - Missing `attributes.<field>` falls back to the corresponding default
 *   attribute path.
 * - Missing `metrics[].format` defaults to `'string'`.
 * - Missing `metrics[].placements` defaults to `['body']`.
 * - Missing `pricing` defaults to an empty registry; built-in costs are only
 *   derived from configured model-keyed pricing and token counts.
 * - Missing `costCurrencies` defaults to an empty list; extra currencies only
 *   affect the expanded LLM calls breakdown table.
 */
export function resolveLlmCallsConfig(
  input: LlmCallsConfigInput | undefined,
): ResolvedLlmCallsConfig {
  return {
    kinds:
      input?.kinds && input.kinds.length > 0
        ? [...input.kinds]
        : [...DEFAULT_LLM_CALLS_CONFIG.kinds],
    attributes: {
      ...DEFAULT_LLM_CALLS_CONFIG.attributes,
      ...input?.attributes,
    },
    derivedAttributes: resolveDerivedAttributes(input?.derivedAttributes),
    metrics: (input?.metrics ?? []).map(resolveLlmCallMetric),
    pricing: Object.entries(input?.pricing ?? {}).flatMap(([model, pricing]) =>
      resolveLlmCallPricingEntries(model, pricing),
    ),
    costCurrencies: (input?.costCurrencies ?? []).map(
      resolveLlmCallCostCurrency,
    ),
  };
}

/**
 * Resolve the user-authored API-calls config to a fully-defaulted shape used
 * by the UI to derive the API calls tab.
 *
 * - Missing or empty `kinds` falls back to common API/HTTP span kinds.
 * - Missing `attributes.<field>` falls back to the corresponding default
 *   attribute path.
 * - Missing `metrics[].format` defaults to `'string'`.
 * - Missing `metrics[].placements` defaults to `['body']`.
 */
export function resolveApiCallsConfig(
  input: ApiCallsConfigInput | undefined,
): ResolvedApiCallsConfig {
  return {
    kinds:
      input?.kinds && input.kinds.length > 0
        ? [...input.kinds]
        : [...DEFAULT_API_CALLS_CONFIG.kinds],
    attributes: {
      ...DEFAULT_API_CALLS_CONFIG.attributes,
      ...input?.attributes,
    },
    derivedAttributes: resolveDerivedAttributes(input?.derivedAttributes),
    metrics: (input?.metrics ?? []).map(resolveApiCallMetric),
  };
}

/** Top-level config authored in `agent-evals.config.ts`. */
export type AgentEvalsConfig = {
  /** Root directory used to resolve all relative paths. Defaults to `process.cwd()`. */
  workspaceRoot?: string;
  /** Glob patterns (relative to `workspaceRoot`) used to discover eval files. */
  include: string[];
  /** Workspace-wide tags inherited by every eval unless removed per eval. */
  tags?: string[];
  /** Number of trials per case when none is specified. Defaults to `1`. */
  defaultTrials?: number;
  /**
   * Strategy used to pick the single persisted result when `trials > 1`.
   *
   * `lowestScore` is the default. `median` uses the lower median when the
   * number of trials is even.
   */
  trialSelection?: TrialSelectionMode;
  /**
   * Maximum number of case executions that may run in parallel across one run,
   * including trial fan-out. Defaults to `2`.
   */
  concurrency?: number;
  /**
   * Age threshold, in days, before a latest run from a different commit is
   * considered outdated. Defaults to `14`.
   */
  staleAfterDays?: number;
  /**
   * Whether `agent-evals run` may run every discovered eval when no `--eval`
   * or `--case` filter is provided. Defaults to `false`; set to `true` to
   * opt into unfiltered CLI runs. Grouped runs in the UI are still allowed.
   */
  allowCliRunAll?: boolean;
  /**
   * Global trace attribute display config for the UI.
   *
   * These rules are merged with per-eval `traceDisplay` rules, with the eval
   * definition taking precedence for matching `key` or `path` entries.
   */
  traceDisplay?: TraceDisplayInputConfig;
  /**
   * Workspace-wide output columns applied to every eval.
   *
   * Eval-level `columns` with the same key take precedence. Built-in default
   * columns are still added first unless removed with `removeDefaultConfig`.
   */
  columns?: EvalColumns;
  /**
   * Workspace-wide trace-derived outputs applied to every eval case.
   *
   * Prefer the keyed map form for shared metrics:
   * `{ toolCalls: ({ trace }) => trace.findSpansByKind('tool').length }`.
   * The object-returning function form is also supported. Derived outputs
   * only fill keys that were not already recorded by eval execution. Do not
   * call assertion helpers here; use `tracingAssertions` for trace-derived
   * pass/fail checks.
   */
  deriveFromTracing?: EvalDeriveConfig;
  /**
   * Workspace-wide assertions derived from the finished execution trace.
   *
   * These run after `deriveFromTracing` and before output schema validation and
   * scores. Use `evalAssert(...)` or `evalExpect(...)` inside the callback to
   * record normal assertion results without creating fake score columns.
   */
  tracingAssertions?: EvalTracingAssertionsConfig;
  /**
   * Workspace-wide stats prepended to every eval's stats row.
   *
   * Eval-level stats render after these, and built-in default stats are
   * appended last unless removed with `removeDefaultConfig`.
   */
  stats?: EvalStatsConfig;
  /**
   * Initial aggregate mode used for duration and column stats on every eval
   * card.
   *
   * Per-eval `defaultStatAggregate` overrides this value. Individual stat
   * `aggregate` values still define their authored reducer and remain the
   * fallback when no default aggregate is configured.
   */
  defaultStatAggregate?: EvalStatAggregate;
  /**
   * Configuration for the "LLM calls" tab in the case-run drawer.
   *
   * Determines which trace spans are treated as LLM calls (`kinds`), how
   * structured fields like `model` and `usage.inputTokens` are read from
   * span attributes, which pricing registry derives built-in costs, and which
   * custom user-defined metrics are surfaced on each call. All fields are
   * optional and fall back to the documented defaults; the LLM calls tab is
   * shown automatically when at least one matching span exists in a case run.
   *
   * @example
   * ```ts
   * llmCalls: {
   *   kinds: ['llm', 'ai-sdk.generateText'],
   *   attributes: {
   *     cachedInputTokens: 'usage.cache_read_input_tokens',
   *   },
   *   metrics: [
   *     { label: 'Retries', path: 'retryCount', format: 'number' },
   *   ],
   *   pricing: {
   *     'gpt-4o-mini': {
   *       provider: 'openai',
   *       inputUsdPerMillion: 0.15,
   *       outputUsdPerMillion: 0.6,
   *     },
   *   },
   *   costCurrencies: [
   *     { code: 'BRL', usdToCurrencyRate: 5.7, numberFormat: { prefix: 'R$ ' } },
   *   ],
   * }
   * ```
   */
  llmCalls?: LlmCallsConfigInput;
  /**
   * Remove built-in eval-level outputs, columns, stats, and charts.
   *
   * Defaults are derived from trace spans using the resolved `llmCalls` and
   * `apiCalls` extraction configs. Set to `true` to remove all defaults, or
   * pass specific keys such as `['costUsd', 'apiCalls']` to remove only those
   * defaults globally. Removing `costUsd` removes the whole default cost
   * family, including normalized no-cache and warmed-cache outputs. Per-eval
   * removal is additive.
   */
  removeDefaultConfig?: RemoveDefaultConfig;
  /**
   * Configuration for the "API calls" tab in the case-run drawer.
   *
   * Determines which trace spans are treated as API calls (`kinds`), how
   * structured fields like `method`, `url`, and `statusCode` are read from
   * span attributes, and which custom user-defined metrics are surfaced on
   * each call. All fields are optional and fall back to the documented
   * defaults; the API calls tab is shown automatically when at least one
   * matching span exists in a case run.
   *
   * @example
   * ```ts
   * apiCalls: {
   *   kinds: ['api', 'http.client', 'undici.request'],
   *   attributes: {
   *     statusCode: 'http.status_code',
   *     routeAlias: 'http.route',
   *   },
   *   metrics: [
   *     { label: 'Retries', path: 'retryCount', format: 'number' },
   *   ],
   * }
   * ```
   */
  apiCalls?: ApiCallsConfigInput;
  /**
   * Configuration for case run logs.
   *
   * Console capture is enabled by default and stores `console.log`,
   * `console.info`, `console.warn`, and `console.error` calls made during
   * active case-owned phases. Set `captureConsole: false` to keep console
   * output visible in the terminal without persisting it to case details.
   * Manual `evalLog(...)` calls are still persisted.
   */
  runLogs?: RunLogsConfigInput;
  /**
   * Optional controls for the operation cache. When omitted, the cache is
   * enabled and stored under `<workspaceRoot>/.agent-evals/cache`.
   */
  cache?: {
    /** Disable the cache entirely; spans with `cache` options execute as if uncached. */
    enabled?: boolean;
    /** Override the directory used to persist cache entries. */
    dir?: string;
    /**
     * Maximum entries retained per cache namespace.
     *
     * Pass a number to set the default cap for every namespace. Pass an object
     * to set a default cap plus exact namespace-specific caps. Non-positive or
     * non-finite values fall back to the default.
     *
     * @example
     * ```ts
     * cache: {
     *   maxEntries: {
     *     default: 50,
     *     namespaces: { 'receipt-audit.receipt-audit-context': 200 },
     *   },
     * }
     * ```
     */
    maxEntries?:
      | number
      | { default?: number; namespaces?: Record<string, number> };
    /**
     * Milliseconds the runner waits after becoming idle before pruning indexed
     * cache entries. Defaults to `5000`; non-positive or non-finite values use
     * the default.
     */
    pruneIdleDelayMs?: number;
    /**
     * Minimum milliseconds between `lastAccessedAt` index rewrites for repeated
     * cache hits. Defaults to four hours. Set to `0` to record every hit.
     */
    lastAccessedAtUpdateIntervalMs?: number;
  };
};

const cacheMaxEntriesSchema = z
  .union([
    z.number(),
    z.object({
      default: z.number().optional(),
      namespaces: z.record(z.string(), z.number()).optional(),
    }),
  ])
  .optional();

/** Zod schema for validating `agent-evals.config.ts` input. */
export const agentEvalsConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  include: z.array(z.string()),
  tags: z.array(z.string()).optional(),
  defaultTrials: z.number().optional(),
  trialSelection: trialSelectionModeSchema.optional(),
  concurrency: z.number().optional(),
  staleAfterDays: z.number().optional(),
  allowCliRunAll: z.boolean().optional(),
  traceDisplay: traceDisplayInputConfigSchema.optional(),
  columns: evalColumnsSchema.optional(),
  deriveFromTracing: evalDeriveConfigSchema.optional(),
  tracingAssertions: evalTracingAssertionsConfigSchema.optional(),
  stats: evalStatsConfigSchema.optional(),
  defaultStatAggregate: evalStatAggregateSchema.optional(),
  llmCalls: llmCallsConfigSchema.optional(),
  removeDefaultConfig: removeDefaultConfigSchema.optional(),
  apiCalls: apiCallsConfigSchema.optional(),
  runLogs: runLogsConfigSchema.optional(),
  cache: z
    .object({
      enabled: z.boolean().optional(),
      dir: z.string().optional(),
      maxEntries: cacheMaxEntriesSchema,
      maxEntriesPerNamespace: z.number().optional(),
      maxEntriesByNamespace: z.record(z.string(), z.number()).optional(),
      pruneIdleDelayMs: z.preprocess(
        (value) =>
          typeof value === 'number' && Number.isFinite(value)
            ? value
            : undefined,
        z.number().optional(),
      ),
      lastAccessedAtUpdateIntervalMs: z.preprocess(
        (value) =>
          typeof value === 'number' && Number.isFinite(value)
            ? value
            : undefined,
        z.number().optional(),
      ),
      maxEntriesPerEval: z.number().optional(),
    })
    .transform(
      ({
        maxEntries,
        maxEntriesByNamespace,
        maxEntriesPerEval,
        maxEntriesPerNamespace,
        ...cache
      }) => {
        const defaultMaxEntries = maxEntriesPerNamespace ?? maxEntriesPerEval;
        if (maxEntries !== undefined) return { ...cache, maxEntries };
        if (
          defaultMaxEntries !== undefined ||
          maxEntriesByNamespace !== undefined
        ) {
          return {
            ...cache,
            maxEntries: {
              default: defaultMaxEntries,
              namespaces: maxEntriesByNamespace,
            },
          };
        }
        return cache;
      },
    )
    .optional(),
});
