import type {
  LlmCallMetricFormat,
  LlmCallMetricPlacement,
  ResolvedLlmCallPricing,
  ResolvedLlmCallsConfig,
} from '../schemas/config.ts';
import type { NumberDisplayOptions } from '../schemas/display.ts';
import type {
  EvalTraceSpan,
  EvalTraceSpanError,
  EvalTraceSpanWarning,
} from '../schemas/trace.ts';
import { getNestedAttribute } from './getNestedAttribute.ts';

/** Resolved value for one user-defined metric on an LLM call row. */
export type LlmCallMetricValue = {
  label: string;
  tooltip: string | undefined;
  rawValue: unknown;
  format: LlmCallMetricFormat;
  numberFormat: NumberDisplayOptions | undefined;
  placements: LlmCallMetricPlacement[];
};

/** Single entry rendered as one expandable row in the LLM calls tab. */
export type LlmCallEntry = {
  id: string;
  name: string;
  kind: string;
  status: EvalTraceSpan['status'];
  model: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  /** Time to first token for the LLM call in milliseconds, when reported by the span. */
  latencyMs: number | null;
  /** Output-token throughput over the full elapsed LLM call duration. */
  tokensPerSecond: number | null;
  costUsd: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  cachedInputCostUsd: number | null;
  cacheCreationInputCostUsd: number | null;
  reasoningCostUsd: number | null;
  /** Number of inference rounds. Derived from the array length when `stepDetails` is set. */
  stepCount: number | null;
  /** Per-step breakdown when the configured `steps` attribute resolves to an array. */
  stepDetails: unknown[] | null;
  finishReason: string | null;
  /** Elapsed LLM call span duration in milliseconds. */
  durationMs: number | null;
  input: unknown;
  output: unknown;
  reasoning: unknown;
  toolCalls: unknown;
  metrics: LlmCallMetricValue[];
  warnings: EvalTraceSpanWarning[];
  error: EvalTraceSpanError | null;
};

function readNumber(attributes: unknown, path: string): number | null {
  const raw = getNestedAttribute(attributes, path);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readString(attributes: unknown, path: string): string | null {
  const raw = getNestedAttribute(attributes, path);
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function computeTokenCost(
  tokens: number | null,
  usdPerMillion: number | undefined,
): number | null {
  if (tokens === null) return null;
  if (tokens === 0) return 0;
  if (usdPerMillion === undefined) return null;
  return (tokens / 1_000_000) * usdPerMillion;
}

function computeCacheCreationInputCost({
  cacheCreationInputTokens,
  cacheCreationInput1hTokens,
  usdPerMillion,
  oneHourUsdPerMillion,
}: {
  cacheCreationInputTokens: number | null;
  cacheCreationInput1hTokens: number | null;
  usdPerMillion: number | undefined;
  oneHourUsdPerMillion: number | undefined;
}): number | null {
  if (cacheCreationInputTokens === null) return null;
  if (cacheCreationInputTokens === 0) return 0;
  if (cacheCreationInput1hTokens === null) {
    return computeTokenCost(cacheCreationInputTokens, usdPerMillion);
  }

  const oneHourTokens = Math.min(
    cacheCreationInput1hTokens,
    cacheCreationInputTokens,
  );
  const shortLivedTokens = cacheCreationInputTokens - oneHourTokens;
  const shortLivedCost = computeTokenCost(shortLivedTokens, usdPerMillion);
  const oneHourCost = computeTokenCost(oneHourTokens, oneHourUsdPerMillion);
  if (shortLivedCost === null || oneHourCost === null) return null;
  return shortLivedCost + oneHourCost;
}

function computeBaseInputTokens({
  inputTokens,
  cachedInputTokens,
  cacheCreationInputTokens,
}: {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
}): number | null {
  if (inputTokens === null) return null;
  const cachedTokens =
    (cachedInputTokens ?? 0) + (cacheCreationInputTokens ?? 0);
  return Math.max(inputTokens - cachedTokens, 0);
}

function pickPricingEntry({
  pricing,
  model,
  provider,
}: {
  pricing: ResolvedLlmCallPricing[];
  model: string | null;
  provider: string | null;
}): ResolvedLlmCallPricing | null {
  if (model === null) return null;

  let fallback: ResolvedLlmCallPricing | null = null;
  for (const entry of pricing) {
    if (entry.model !== model) continue;
    if (entry.provider === undefined) {
      fallback ??= entry;
      continue;
    }
    if (entry.provider === provider) return entry;
  }

  return fallback;
}

function computeTotalCost({
  inputTokens,
  inputCostUsd,
  outputTokens,
  outputCostUsd,
  cachedInputTokens,
  cachedInputCostUsd,
  cacheCreationInputTokens,
  cacheCreationInputCostUsd,
  reasoningTokens,
  reasoningCostUsd,
}: {
  inputTokens: number | null;
  inputCostUsd: number | null;
  outputTokens: number | null;
  outputCostUsd: number | null;
  cachedInputTokens: number | null;
  cachedInputCostUsd: number | null;
  cacheCreationInputTokens: number | null;
  cacheCreationInputCostUsd: number | null;
  reasoningTokens: number | null;
  reasoningCostUsd: number | null;
}): number | null {
  const parts = [
    { tokens: inputTokens, cost: inputCostUsd },
    { tokens: outputTokens, cost: outputCostUsd },
    { tokens: cachedInputTokens, cost: cachedInputCostUsd },
    { tokens: cacheCreationInputTokens, cost: cacheCreationInputCostUsd },
    { tokens: reasoningTokens, cost: reasoningCostUsd },
  ];

  let total = 0;
  let hasCost = false;
  let hasReportedTokens = false;
  for (const part of parts) {
    if (part.tokens === null) continue;
    hasReportedTokens = true;
    if (part.tokens === 0) continue;
    if (part.cost === null) return null;
    total += part.cost;
    hasCost = true;
  }

  if (hasCost) return total;
  return hasReportedTokens ? 0 : null;
}

/**
 * Cost-simulation scenarios available in the LLM calls breakdown table.
 *
 * - `actual` — Real billed cost recorded on the span.
 * - `noCache` — Bill every input token at the base input rate, ignoring all
 *   cache reads and cache writes. Worst case for any prompt that could be
 *   cached.
 * - `withBaseCaching` — Steady-state cost on a fully warmed cache: cache
 *   writes are treated as already paid (free), cache reads keep the cache-read
 *   discount, and base input keeps the base rate. When the call has no
 *   caching at all, every input token is billed at the cache-read rate, as if
 *   the prompt had been warmed by an earlier run. Cache-read pricing is the
 *   same on the base (5-minute) and extended (1-hour) tiers, so this scenario
 *   covers the warmed case for both TTLs.
 * - `withBaseCachingWrite` — First-call cost paying the 5-minute cache write
 *   premium. When the call already uses caching, every cache write token is
 *   billed at the 5-minute rate (any extended-cache split is folded into the
 *   5-minute rate). When the call has no caching at all, every input token is
 *   billed at the 5-minute cache write rate, as if this were the first call
 *   warming up the base cache.
 * - `withExtendedCachingWrite` — First-call cost paying the extended (e.g.
 *   1-hour) cache write premium. When the call already uses caching, every
 *   cache write token is billed at the extended rate. When the call has no
 *   caching at all, every input token is billed at the extended cache write
 *   rate, as if this were the first call warming up the extended cache.
 */
export type LlmCostScenario =
  | 'actual'
  | 'noCache'
  | 'withBaseCaching'
  | 'withBaseCachingWrite'
  | 'withExtendedCachingWrite';

/** Per-row cost values returned by {@link simulateLlmCallCost}. */
export type LlmCallCostBreakdown = {
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  cachedInputCostUsd: number | null;
  cacheCreationInputCostUsd: number | null;
  reasoningCostUsd: number | null;
  totalCostUsd: number | null;
};

/**
 * Recompute the LLM-call cost breakdown for a hypothetical billing scenario,
 * using the call's recorded token counts and the resolved pricing registry.
 *
 * The `actual` scenario returns the costs already stored on `entry`. Other
 * scenarios re-derive each cost component from `pricing` so users can compare
 * what the same usage would have cost under different cache strategies. When
 * pricing is missing for the model/provider, simulated cost components fall
 * back to `null` exactly like the original extractor.
 */
export function simulateLlmCallCost({
  entry,
  pricing,
  scenario,
}: {
  entry: LlmCallEntry;
  pricing: ResolvedLlmCallPricing[];
  scenario: LlmCostScenario;
}): LlmCallCostBreakdown {
  if (scenario === 'actual') {
    return {
      inputCostUsd: entry.inputCostUsd,
      outputCostUsd: entry.outputCostUsd,
      cachedInputCostUsd: entry.cachedInputCostUsd,
      cacheCreationInputCostUsd: entry.cacheCreationInputCostUsd,
      reasoningCostUsd: entry.reasoningCostUsd,
      totalCostUsd: entry.costUsd,
    };
  }

  const pricingEntry = pickPricingEntry({
    pricing,
    model: entry.model,
    provider: entry.provider,
  });

  const outputCostUsd = computeTokenCost(
    entry.outputTokens,
    pricingEntry?.outputUsdPerMillion,
  );
  const reasoningCostUsd = computeTokenCost(
    entry.reasoningTokens,
    pricingEntry?.reasoningUsdPerMillion,
  );

  const simulatedTokens = simulateTokenAllocation({ entry, scenario });
  const writeRate =
    scenario === 'withExtendedCachingWrite'
      ? pricingEntry?.cacheCreationInput1hUsdPerMillion
      : pricingEntry?.cacheCreationInputUsdPerMillion;

  const inputCostUsd = computeTokenCost(
    simulatedTokens.baseInputTokens,
    pricingEntry?.inputUsdPerMillion,
  );
  const cachedInputCostUsd = computeTokenCost(
    simulatedTokens.cachedInputTokens,
    pricingEntry?.cachedInputUsdPerMillion,
  );
  const cacheCreationInputCostUsd = computeTokenCost(
    simulatedTokens.cacheCreationInputTokens,
    writeRate,
  );

  const totalCostUsd = computeTotalCost({
    inputTokens: simulatedTokens.baseInputTokens,
    inputCostUsd,
    outputTokens: entry.outputTokens,
    outputCostUsd,
    cachedInputTokens: simulatedTokens.cachedInputTokens,
    cachedInputCostUsd,
    cacheCreationInputTokens: simulatedTokens.cacheCreationInputTokens,
    cacheCreationInputCostUsd,
    reasoningTokens: entry.reasoningTokens,
    reasoningCostUsd,
  });

  return {
    inputCostUsd,
    outputCostUsd,
    cachedInputCostUsd,
    cacheCreationInputCostUsd,
    reasoningCostUsd,
    totalCostUsd,
  };
}

/** Per-row simulated token counts shown in the LLM call breakdown table. */
export type LlmCallSimulatedTokens = {
  /** Tokens shown on the `Input` row — base input only (cached + creation are subtracted). */
  baseInputTokens: number | null;
  /** Tokens shown on the `Cache read` row. */
  cachedInputTokens: number | null;
  /** Tokens shown on the `Cache write` row. */
  cacheCreationInputTokens: number | null;
};

/**
 * Project the call's recorded token allocation onto a hypothetical billing
 * scenario. Cacheable tokens shift between rows so the breakdown reflects the
 * simulated billing model: `noCache` folds reads/writes into base input,
 * `withBaseCaching` (warmed) treats every cacheable token as a cache read, and
 * the first-call write scenarios treat every cacheable token as a cache write.
 *
 * The returned counts are what the UI renders on each row and what
 * {@link simulateLlmCallCost} prices, so display and totals never drift.
 */
export function simulateTokenAllocation({
  entry,
  scenario,
}: {
  entry: LlmCallEntry;
  scenario: LlmCostScenario;
}): LlmCallSimulatedTokens {
  const baseInputTokens = computeBaseInputTokens({
    inputTokens: entry.inputTokens,
    cachedInputTokens: entry.cachedInputTokens,
    cacheCreationInputTokens: entry.cacheCreationInputTokens,
  });

  if (scenario === 'actual' || entry.inputTokens === null) {
    return {
      baseInputTokens,
      cachedInputTokens: entry.cachedInputTokens,
      cacheCreationInputTokens: entry.cacheCreationInputTokens,
    };
  }

  const cacheableTokens =
    (entry.cachedInputTokens ?? 0) + (entry.cacheCreationInputTokens ?? 0);
  const hasCacheable = cacheableTokens > 0;

  if (scenario === 'noCache') {
    // All cacheable tokens fold into base input.
    return {
      baseInputTokens: entry.inputTokens,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  }

  if (scenario === 'withBaseCaching') {
    // Warmed steady state: no writes, every cacheable token becomes a read.
    return {
      baseInputTokens: hasCacheable ? baseInputTokens : 0,
      cachedInputTokens: hasCacheable ? cacheableTokens : entry.inputTokens,
      cacheCreationInputTokens: 0,
    };
  }

  // First-call write scenarios: no reads, every cacheable token becomes a write.
  return {
    baseInputTokens: hasCacheable ? baseInputTokens : 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: hasCacheable
      ? cacheableTokens
      : entry.inputTokens,
  };
}

function computeDurationMs(span: EvalTraceSpan): number | null {
  if (span.endedAt === null) return null;
  const started = Date.parse(span.startedAt);
  const ended = Date.parse(span.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  const delta = ended - started;
  return delta >= 0 ? delta : null;
}

function computeTotalTokens({
  input,
  output,
}: {
  input: number | null;
  output: number | null;
}): number | null {
  if (input === null && output === null) return null;
  return (input ?? 0) + (output ?? 0);
}

function computeTokensPerSecond({
  outputTokens,
  durationMs,
}: {
  outputTokens: number | null;
  durationMs: number | null;
}): number | null {
  if (outputTokens === null || durationMs === null) return null;
  if (outputTokens === 0) return 0;
  if (durationMs <= 0) return null;
  return outputTokens / (durationMs / 1000);
}

function readSteps(
  attributes: unknown,
  path: string,
): { stepCount: number | null; stepDetails: unknown[] | null } {
  const raw = getNestedAttribute(attributes, path);
  if (Array.isArray(raw)) {
    return { stepCount: raw.length, stepDetails: raw };
  }
  return { stepCount: null, stepDetails: null };
}

function collectWarnings(span: EvalTraceSpan): EvalTraceSpanWarning[] {
  const out: EvalTraceSpanWarning[] = [];
  if (span.warning) out.push(span.warning);
  if (span.warnings) out.push(...span.warnings);
  return out;
}

function pickError(span: EvalTraceSpan): EvalTraceSpanError | null {
  if (span.error) return span.error;
  if (span.errors && span.errors.length > 0) return span.errors[0] ?? null;
  return null;
}

/**
 * Filter `spans` down to LLM calls and project each one to the structured
 * shape consumed by the LLM calls tab.
 *
 * Spans whose `kind` is not in `config.kinds` are dropped. Structured fields
 * (`model`, token counts, latency, etc.) are read via
 * `getNestedAttribute` from the configured paths, with safe coercion to
 * `string | null` / `number | null`. `latencyMs` is an explicit
 * time-to-first-token attribute; full span elapsed time is reported separately
 * as `durationMs`. `tokensPerSecond` is output tokens divided by that full
 * elapsed duration. Built-in USD costs are derived only from configured model
 * pricing and token counts. `totalTokens` is always derived from input +
 * output tokens. Cached input and cache creation tokens are reported
 * separately because they are subsets of input/output usage. The main cache
 * creation token field is treated as the total write count; optional one-hour
 * cache creation tokens only split that total for cost calculation. Base input
 * cost uses input minus cache read/write tokens so cached tokens are not
 * charged twice. Cache read/write costs still contribute to the total USD cost
 * at their configured rates. The `steps` attribute path may resolve to an array
 * of per-step detail objects, with `stepCount` derived from the array length.
 * `durationMs` and `tokensPerSecond` are `null` while the span is still
 * running. User-defined `metrics` whose path resolves to
 * `undefined` are dropped, but `null`, `0`, and `false` are preserved as
 * legitimate values worth displaying. Original span order is preserved so the
 * LLM calls tab matches the ordering in the Trace tab.
 */
export function extractLlmCalls(
  spans: EvalTraceSpan[],
  config: ResolvedLlmCallsConfig,
): LlmCallEntry[] {
  const kindSet = new Set(config.kinds);
  const result: LlmCallEntry[] = [];

  for (const span of spans) {
    if (!kindSet.has(span.kind)) continue;

    const attrs = span.attributes;
    const model = readString(attrs, config.attributes.model);
    const provider = readString(attrs, config.attributes.provider);
    const inputTokens = readNumber(attrs, config.attributes.inputTokens);
    const outputTokens = readNumber(attrs, config.attributes.outputTokens);
    const cachedInputTokens = readNumber(
      attrs,
      config.attributes.cachedInputTokens,
    );
    const cacheCreationInputTokens = readNumber(
      attrs,
      config.attributes.cacheCreationInputTokens,
    );
    const cacheCreationInput1hTokens = readNumber(
      attrs,
      config.attributes.cacheCreationInput1hTokens,
    );
    const reasoningTokens = readNumber(
      attrs,
      config.attributes.reasoningTokens,
    );
    const latencyMs = readNumber(attrs, config.attributes.latencyMs);
    const durationMs = computeDurationMs(span);
    const pricing = pickPricingEntry({
      pricing: config.pricing,
      model,
      provider,
    });
    const baseInputTokens = computeBaseInputTokens({
      inputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
    });
    const inputCostUsd = computeTokenCost(
      baseInputTokens,
      pricing?.inputUsdPerMillion,
    );
    const outputCostUsd = computeTokenCost(
      outputTokens,
      pricing?.outputUsdPerMillion,
    );
    const cachedInputCostUsd = computeTokenCost(
      cachedInputTokens,
      pricing?.cachedInputUsdPerMillion,
    );
    const cacheCreationInputCostUsd = computeCacheCreationInputCost({
      cacheCreationInputTokens,
      cacheCreationInput1hTokens,
      usdPerMillion: pricing?.cacheCreationInputUsdPerMillion,
      oneHourUsdPerMillion: pricing?.cacheCreationInput1hUsdPerMillion,
    });
    const reasoningCostUsd = computeTokenCost(
      reasoningTokens,
      pricing?.reasoningUsdPerMillion,
    );
    const costUsd = computeTotalCost({
      inputTokens,
      inputCostUsd,
      outputTokens,
      outputCostUsd,
      cachedInputTokens,
      cachedInputCostUsd,
      cacheCreationInputTokens,
      cacheCreationInputCostUsd,
      reasoningTokens,
      reasoningCostUsd,
    });

    const metrics: LlmCallMetricValue[] = [];
    for (const metric of config.metrics) {
      const rawValue = getNestedAttribute(attrs, metric.path);
      if (rawValue === undefined) continue;
      metrics.push({
        label: metric.label,
        tooltip: metric.tooltip,
        rawValue,
        format: metric.format,
        numberFormat: metric.numberFormat,
        placements: metric.placements,
      });
    }

    result.push({
      id: span.id,
      name: span.name,
      kind: span.kind,
      status: span.status,
      model,
      provider,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      reasoningTokens,
      totalTokens: computeTotalTokens({
        input: inputTokens,
        output: outputTokens,
      }),
      latencyMs,
      tokensPerSecond: computeTokensPerSecond({ outputTokens, durationMs }),
      costUsd,
      inputCostUsd,
      outputCostUsd,
      cachedInputCostUsd,
      cacheCreationInputCostUsd,
      reasoningCostUsd,
      ...readSteps(attrs, config.attributes.steps),
      finishReason: readString(attrs, config.attributes.finishReason),
      durationMs,
      input: getNestedAttribute(attrs, config.attributes.input),
      output: getNestedAttribute(attrs, config.attributes.output),
      reasoning: getNestedAttribute(attrs, config.attributes.reasoning),
      toolCalls: getNestedAttribute(attrs, config.attributes.toolCalls),
      metrics,
      warnings: collectWarnings(span),
      error: pickError(span),
    });
  }

  return result;
}
