import type {
  ApiCallMetricFormat,
  ApiCallMetricPlacement,
  ResolvedApiCallsConfig,
} from '../schemas/config.ts';
import type { NumberDisplayOptions } from '../schemas/display.ts';
import type {
  EvalTraceSpan,
  EvalTraceSpanError,
  EvalTraceSpanWarning,
} from '../schemas/trace.ts';
import { getNestedAttribute } from './getNestedAttribute.ts';

/** Resolved value for one user-defined metric on an API call row. */
export type ApiCallMetricValue = {
  label: string;
  tooltip: string | undefined;
  rawValue: unknown;
  format: ApiCallMetricFormat;
  numberFormat: NumberDisplayOptions | undefined;
  placements: ApiCallMetricPlacement[];
};

/** Single entry rendered as one expandable row in the API calls tab. */
export type ApiCallEntry = {
  id: string;
  name: string;
  kind: string;
  status: EvalTraceSpan['status'];
  method: string | null;
  url: string | null;
  statusCode: number | null;
  /** Elapsed API call duration in milliseconds. */
  durationMs: number | null;
  request: unknown;
  response: unknown;
  requestBody: unknown;
  responseBody: unknown;
  headers: unknown;
  errorPayload: unknown;
  metrics: ApiCallMetricValue[];
  warnings: EvalTraceSpanWarning[];
  error: EvalTraceSpanError | null;
};

function readNumber(attributes: unknown, path: string): number | null {
  const raw = getNestedAttribute(attributes, path);
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(attributes: unknown, path: string): string | null {
  const raw = getNestedAttribute(attributes, path);
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function computeDurationMs(span: EvalTraceSpan): number | null {
  if (span.endedAt === null) return null;
  const started = Date.parse(span.startedAt);
  const ended = Date.parse(span.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  const delta = ended - started;
  return delta >= 0 ? delta : null;
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
 * Filter `spans` down to API calls and project each one to the structured
 * shape consumed by the API calls tab.
 *
 * Spans whose `kind` is not in `config.kinds` are dropped. Structured fields
 * (`method`, `url`, `statusCode`, etc.) are read via `getNestedAttribute` from
 * the configured paths. An explicit `durationMs` attribute takes precedence,
 * with a fallback to the span start/end timestamps. User-defined `metrics`
 * whose path resolves to `undefined` are dropped, but `null`, `0`, and `false`
 * are preserved as legitimate values worth displaying. Original span order is
 * preserved so the API calls tab matches the ordering in the Trace tab.
 */
export function extractApiCalls(
  spans: EvalTraceSpan[],
  config: ResolvedApiCallsConfig,
): ApiCallEntry[] {
  const kindSet = new Set(config.kinds);
  const result: ApiCallEntry[] = [];

  for (const span of spans) {
    if (!kindSet.has(span.kind)) continue;

    const attrs = span.attributes;
    const metrics: ApiCallMetricValue[] = [];
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
      method: readString(attrs, config.attributes.method),
      url: readString(attrs, config.attributes.url),
      statusCode: readNumber(attrs, config.attributes.statusCode),
      durationMs:
        readNumber(attrs, config.attributes.durationMs) ??
        computeDurationMs(span),
      request: getNestedAttribute(attrs, config.attributes.request),
      response: getNestedAttribute(attrs, config.attributes.response),
      requestBody: getNestedAttribute(attrs, config.attributes.requestBody),
      responseBody: getNestedAttribute(attrs, config.attributes.responseBody),
      headers: getNestedAttribute(attrs, config.attributes.headers),
      errorPayload: getNestedAttribute(attrs, config.attributes.error),
      metrics,
      warnings: collectWarnings(span),
      error: pickError(span),
    });
  }

  return result;
}
