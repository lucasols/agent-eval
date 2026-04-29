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
  latencyMs: number | null;
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

function computeFallbackTotalCost({
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

function computeLatencyMs(span: EvalTraceSpan): number | null {
  if (span.endedAt === null) return null;
  const started = Date.parse(span.startedAt);
  const ended = Date.parse(span.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  const delta = ended - started;
  return delta >= 0 ? delta : null;
}

function computeTotalTokens({
  declared,
  input,
  output,
  cached,
  cacheCreation,
}: {
  declared: number | null;
  input: number | null;
  output: number | null;
  cached: number | null;
  cacheCreation: number | null;
}): number | null {
  if (declared !== null) return declared;
  if (
    input === null &&
    output === null &&
    cached === null &&
    cacheCreation === null
  ) {
    return null;
  }
  return (input ?? 0) + (output ?? 0) + (cached ?? 0) + (cacheCreation ?? 0);
}

function readSteps(
  attributes: unknown,
  path: string,
): { stepCount: number | null; stepDetails: unknown[] | null } {
  const raw = getNestedAttribute(attributes, path);
  if (Array.isArray(raw)) {
    return { stepCount: raw.length, stepDetails: raw };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { stepCount: raw, stepDetails: null };
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
 * (`model`, token counts, explicit cost, etc.) are read via
 * `getNestedAttribute` from the configured paths, with safe coercion to
 * `string | null` / `number | null`. When explicit USD costs are absent,
 * configured model pricing derives per-token-type costs from token counts.
 * `totalTokens` falls back to a sum of input + output + cached when no
 * explicit total attribute is present. The `steps` attribute path may resolve
 * to either a number (rendered as the inference-round count) or an array of
 * per-step detail objects (rendered as a Steps section in the body, with
 * `stepCount` derived from the array length). `latencyMs` is `null` while the
 * span is still running. User-defined `metrics` whose path resolves to
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
    const reasoningTokens = readNumber(
      attrs,
      config.attributes.reasoningTokens,
    );
    const declaredTotalTokens = readNumber(
      attrs,
      config.attributes.totalTokens,
    );
    const pricing = pickPricingEntry({
      pricing: config.pricing,
      model,
      provider,
    });
    const inputCostUsd =
      readNumber(attrs, config.attributes.inputCost) ??
      computeTokenCost(inputTokens, pricing?.inputUsdPerMillion);
    const outputCostUsd =
      readNumber(attrs, config.attributes.outputCost) ??
      computeTokenCost(outputTokens, pricing?.outputUsdPerMillion);
    const cachedInputCostUsd =
      readNumber(attrs, config.attributes.cachedInputCost) ??
      computeTokenCost(cachedInputTokens, pricing?.cachedInputUsdPerMillion);
    const cacheCreationInputCostUsd =
      readNumber(attrs, config.attributes.cacheCreationInputCost) ??
      computeTokenCost(
        cacheCreationInputTokens,
        pricing?.cacheCreationInputUsdPerMillion,
      );
    const reasoningCostUsd =
      readNumber(attrs, config.attributes.reasoningCost) ??
      computeTokenCost(reasoningTokens, pricing?.reasoningUsdPerMillion);
    const costUsd =
      readNumber(attrs, config.attributes.cost) ??
      computeFallbackTotalCost({
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
        declared: declaredTotalTokens,
        input: inputTokens,
        output: outputTokens,
        cached: cachedInputTokens,
        cacheCreation: cacheCreationInputTokens,
      }),
      costUsd,
      inputCostUsd,
      outputCostUsd,
      cachedInputCostUsd,
      cacheCreationInputCostUsd,
      reasoningCostUsd,
      ...readSteps(attrs, config.attributes.steps),
      finishReason: readString(attrs, config.attributes.finishReason),
      latencyMs: computeLatencyMs(span),
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
