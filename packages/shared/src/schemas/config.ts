import { z } from 'zod/v4';
import {
  numberDisplayOptionsSchema,
  type NumberDisplayOptions,
} from './display.ts';
import {
  traceDisplayInputConfigSchema,
  type TraceDisplayInputConfig,
} from './trace.ts';

/** Strategy used to collapse repeated trials into one stored case result. */
export const trialSelectionModeSchema = z.enum(['lowestScore', 'median']);
/** Strategy used to collapse repeated trials into one stored case result. */
export type TrialSelectionMode = z.infer<typeof trialSelectionModeSchema>;

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

/**
 * Schema for a single user-defined metric attached to LLM call rows.
 *
 * Each metric reads `path` from the span's `attributes` and renders the value
 * with the configured `format` and `numberFormat`. `placements` controls
 * whether the metric appears as a chip on the collapsed row header, as a row
 * inside the expanded body, or both. Defaults to `['body']` when omitted.
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
 * with the configured `format` and `numberFormat`. `placements` controls
 * whether the metric appears as a chip on the collapsed row header, as a row
 * inside the expanded body, or both. Defaults to `['body']` when omitted.
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

/** Schema for the global LLM calls config block in `agent-evals.config.ts`. */
export const llmCallsConfigSchema = z.object({
  /** Span kinds treated as LLM calls. Defaults to `['llm']`. */
  kinds: z.array(z.string().min(1)).optional(),
  /**
   * Attribute paths used to extract structured per-call fields. Each entry is
   * a dot-path inside `span.attributes`. Missing paths fall back to the
   * built-in defaults (e.g. `usage.inputTokens`, `costUsd`).
   *
   * Per-token-type cost paths (`inputCost`, `outputCost`, `cachedInputCost`,
   * `reasoningCost`) feed the cost breakdown table in the expanded row.
   * Record them as USD numbers alongside `costUsd` in your span attributes.
   */
  attributes: z
    .object({
      model: z.string().optional(),
      provider: z.string().optional(),
      inputTokens: z.string().optional(),
      outputTokens: z.string().optional(),
      cachedInputTokens: z.string().optional(),
      cacheCreationInputTokens: z.string().optional(),
      reasoningTokens: z.string().optional(),
      totalTokens: z.string().optional(),
      cost: z.string().optional(),
      inputCost: z.string().optional(),
      outputCost: z.string().optional(),
      cachedInputCost: z.string().optional(),
      cacheCreationInputCost: z.string().optional(),
      reasoningCost: z.string().optional(),
      steps: z.string().optional(),
      finishReason: z.string().optional(),
      input: z.string().optional(),
      output: z.string().optional(),
      reasoning: z.string().optional(),
      toolCalls: z.string().optional(),
    })
    .optional(),
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
  /** Custom user-defined metrics surfaced on each API call. */
  metrics: z.array(apiCallMetricSchema).optional(),
});
/** Authored API calls config accepted from `agent-evals.config.ts`. */
export type ApiCallsConfigInput = z.infer<typeof apiCallsConfigSchema>;

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
    reasoningTokens: string;
    totalTokens: string;
    cost: string;
    inputCost: string;
    outputCost: string;
    cachedInputCost: string;
    cacheCreationInputCost: string;
    reasoningCost: string;
    steps: string;
    finishReason: string;
    input: string;
    output: string;
    reasoning: string;
    toolCalls: string;
  };
  metrics: ResolvedLlmCallMetric[];
};

/** Resolved API-calls config sent to the UI with all defaults applied. */
export type ResolvedApiCallsConfig = {
  kinds: string[];
  attributes: {
    method: string;
    url: string;
    statusCode: string;
    request: string;
    response: string;
    requestBody: string;
    responseBody: string;
    headers: string;
    durationMs: string;
    error: string;
  };
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
    reasoningTokens: 'usage.reasoningTokens',
    totalTokens: 'usage.totalTokens',
    cost: 'costUsd',
    inputCost: 'cost.inputUsd',
    outputCost: 'cost.outputUsd',
    cachedInputCost: 'cost.cachedInputUsd',
    cacheCreationInputCost: 'cost.cacheCreationInputUsd',
    reasoningCost: 'cost.reasoningUsd',
    steps: 'steps',
    finishReason: 'finishReason',
    input: 'input',
    output: 'output',
    reasoning: 'reasoning',
    toolCalls: 'toolCalls',
  },
  metrics: [],
};

/** Default API-calls config the UI uses before the workspace fetch resolves. */
export const DEFAULT_API_CALLS_CONFIG: ResolvedApiCallsConfig = {
  kinds: ['api', 'http', 'http.client', 'fetch'],
  attributes: {
    method: 'method',
    url: 'url',
    statusCode: 'statusCode',
    request: 'request',
    response: 'response',
    requestBody: 'requestBody',
    responseBody: 'responseBody',
    headers: 'headers',
    durationMs: 'durationMs',
    error: 'error',
  },
  metrics: [],
};

/**
 * Resolve the user-authored LLM-calls config to a fully-defaulted shape used
 * by the UI to derive the LLM calls tab.
 *
 * - Missing or empty `kinds` falls back to `['llm']`.
 * - Missing `attributes.<field>` falls back to the corresponding default
 *   attribute path.
 * - Missing `metrics[].format` defaults to `'string'`.
 * - Missing `metrics[].placements` defaults to `['body']`.
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
    metrics: (input?.metrics ?? []).map((m) => ({
      label: m.label,
      tooltip: m.tooltip,
      path: m.path,
      format: m.format ?? 'string',
      numberFormat: m.numberFormat,
      placements: m.placements ? [...m.placements] : ['body'],
    })),
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
    metrics: (input?.metrics ?? []).map((m) => ({
      label: m.label,
      tooltip: m.tooltip,
      path: m.path,
      format: m.format ?? 'string',
      numberFormat: m.numberFormat,
      placements: m.placements ? [...m.placements] : ['body'],
    })),
  };
}

/** Top-level config authored in `agent-evals.config.ts`. */
export type AgentEvalsConfig = {
  /** Root directory used to resolve all relative paths. Defaults to `process.cwd()`. */
  workspaceRoot?: string;
  /** Glob patterns (relative to `workspaceRoot`) used to discover eval files. */
  include: string[];
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
   * Global trace attribute display config for the UI.
   *
   * These rules are merged with per-eval `traceDisplay` rules, with the eval
   * definition taking precedence for matching `key` or `path` entries.
   */
  traceDisplay?: TraceDisplayInputConfig;
  /**
   * Configuration for the "LLM calls" tab in the case-run drawer.
   *
   * Determines which trace spans are treated as LLM calls (`kinds`), how
   * structured fields like `model` and `usage.inputTokens` are read from
   * span attributes, and which custom user-defined metrics are surfaced on
   * each call. All fields are optional and fall back to the documented
   * defaults; the LLM calls tab is shown automatically when at least one
   * matching span exists in a case run.
   *
   * @example
   * ```ts
   * llmCalls: {
   *   kinds: ['llm', 'ai-sdk.generateText'],
   *   attributes: {
   *     cachedInputTokens: 'usage.cache_read_input_tokens',
   *   },
   *   metrics: [
   *     { label: 'Tokens/sec', path: 'tokensPerSecond', format: 'number',
   *       numberFormat: { decimalPlaces: 1 }, placements: ['header', 'body'] },
   *     { label: 'Retries', path: 'retryCount', format: 'number' },
   *   ],
   * }
   * ```
   */
  llmCalls?: LlmCallsConfigInput;
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
   *   },
   *   metrics: [
   *     { label: 'Retries', path: 'retryCount', format: 'number' },
   *   ],
   * }
   * ```
   */
  apiCalls?: ApiCallsConfigInput;
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
     * Default maximum entries retained for each cache namespace. Defaults to
     * `100`; non-positive or non-finite values fall back to the default.
     */
    maxEntriesPerNamespace?: number;
    /**
     * Exact namespace-specific retention caps. Values override
     * `maxEntriesPerNamespace` for matching namespaces.
     */
    maxEntriesByNamespace?: Record<string, number>;
    /** Legacy alias for `maxEntriesPerNamespace`, retained so older config files keep working. */
    maxEntriesPerEval?: number;
  };
};

/** Zod schema for validating `agent-evals.config.ts` input. */
export const agentEvalsConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  include: z.array(z.string()),
  defaultTrials: z.number().optional(),
  trialSelection: trialSelectionModeSchema.optional(),
  concurrency: z.number().optional(),
  staleAfterDays: z.number().optional(),
  traceDisplay: traceDisplayInputConfigSchema.optional(),
  llmCalls: llmCallsConfigSchema.optional(),
  apiCalls: apiCallsConfigSchema.optional(),
  cache: z
    .object({
      enabled: z.boolean().optional(),
      dir: z.string().optional(),
      maxEntriesPerNamespace: z.preprocess(
        (value) =>
          typeof value === 'number' && Number.isFinite(value)
            ? value
            : undefined,
        z.number().optional(),
      ),
      maxEntriesByNamespace: z.record(z.string(), z.number()).optional(),
      maxEntriesPerEval: z.preprocess(
        (value) =>
          typeof value === 'number' && Number.isFinite(value)
            ? value
            : undefined,
        z.number().optional(),
      ),
    })
    .optional(),
});
