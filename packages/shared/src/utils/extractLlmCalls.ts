import type {
  LlmCallMetricFormat,
  LlmCallMetricPlacement,
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
  reasoningTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  steps: number | null;
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
}: {
  declared: number | null;
  input: number | null;
  output: number | null;
  cached: number | null;
}): number | null {
  if (declared !== null) return declared;
  if (input === null && output === null && cached === null) return null;
  return (input ?? 0) + (output ?? 0) + (cached ?? 0);
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
 * (`model`, token counts, cost, etc.) are read via `getNestedAttribute` from
 * the configured paths, with safe coercion to `string | null` / `number |
 * null`. `totalTokens` falls back to a sum of input + output + cached when no
 * explicit total attribute is present. `latencyMs` is `null` while the span
 * is still running. User-defined `metrics` whose path resolves to `undefined`
 * are dropped, but `null`, `0`, and `false` are preserved as legitimate
 * values worth displaying. Original span order is preserved so the LLM calls
 * tab matches the ordering in the Trace tab.
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
    const inputTokens = readNumber(attrs, config.attributes.inputTokens);
    const outputTokens = readNumber(attrs, config.attributes.outputTokens);
    const cachedInputTokens = readNumber(
      attrs,
      config.attributes.cachedInputTokens,
    );
    const reasoningTokens = readNumber(
      attrs,
      config.attributes.reasoningTokens,
    );
    const declaredTotalTokens = readNumber(
      attrs,
      config.attributes.totalTokens,
    );

    const metrics: LlmCallMetricValue[] = [];
    for (const metric of config.metrics) {
      const rawValue = getNestedAttribute(attrs, metric.path);
      if (rawValue === undefined) continue;
      metrics.push({
        label: metric.label,
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
      model: readString(attrs, config.attributes.model),
      provider: readString(attrs, config.attributes.provider),
      inputTokens,
      outputTokens,
      cachedInputTokens,
      reasoningTokens,
      totalTokens: computeTotalTokens({
        declared: declaredTotalTokens,
        input: inputTokens,
        output: outputTokens,
        cached: cachedInputTokens,
      }),
      costUsd: readNumber(attrs, config.attributes.cost),
      steps: readNumber(attrs, config.attributes.steps),
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
