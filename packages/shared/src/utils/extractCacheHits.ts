import { traceCacheRefSchema, type TraceCacheRef } from '../schemas/cache.ts';
import type { EvalTraceSpan } from '../schemas/trace.ts';

/**
 * Single cache-hit entry rendered as one row in the case drawer's
 * "Cache hits" tab.
 *
 * `origin === 'span'` rows came from a span's `cache.status` attribute or from
 * a `cache.refs` ref attached to a span body. `origin === 'caseRoot'` rows
 * came from `evalTracer.cache(...)` calls made directly from the case body
 * (no surrounding `traceSpan`), which would otherwise be invisible.
 */
export type CacheHitEntry = {
  id: string;
  source: 'span' | 'value';
  origin: 'span' | 'caseRoot';
  name: string;
  namespace: string;
  key: string;
  storedAt: string | undefined;
  age: number | undefined;
  spanId: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(attributes: unknown, key: string): string | undefined {
  if (!isRecord(attributes)) return undefined;
  const value = attributes[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(attributes: unknown, key: string): number | undefined {
  if (!isRecord(attributes)) return undefined;
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readArray(attributes: unknown, key: string): unknown[] {
  if (!isRecord(attributes)) return [];
  const value = attributes[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Collect every `status === 'hit'` cache event recorded for a case run.
 *
 * Walks `spans` for span-level cache hits (`attributes['cache.status'] ===
 * 'hit'`) and per-span value-cache refs (`attributes['cache.refs']`), then
 * appends spanless value-cache refs persisted on the case scope. Non-hit
 * statuses (`miss`/`refresh`/`bypass`) are skipped — they remain visible
 * inline in the Trace tab.
 */
export function extractCacheHits(
  spans: EvalTraceSpan[],
  caseCacheRefs: TraceCacheRef[],
): CacheHitEntry[] {
  const entries: CacheHitEntry[] = [];

  for (const span of spans) {
    const status = readString(span.attributes, 'cache.status');
    if (status === 'hit') {
      const key = readString(span.attributes, 'cache.key');
      const namespace = readString(span.attributes, 'cache.namespace');
      if (key !== undefined && namespace !== undefined) {
        entries.push({
          id: span.id,
          source: 'span',
          origin: 'span',
          name: span.name,
          namespace,
          key,
          storedAt: readString(span.attributes, 'cache.storedAt'),
          age: readNumber(span.attributes, 'cache.age'),
          spanId: span.id,
        });
      }
    }

    const rawRefs = readArray(span.attributes, 'cache.refs');
    for (const [index, rawRef] of rawRefs.entries()) {
      const parsed = traceCacheRefSchema.safeParse(rawRef);
      if (!parsed.success) continue;
      const ref = parsed.data;
      if (ref.status !== 'hit') continue;
      entries.push({
        id: `${span.id}:value:${String(index)}`,
        source: 'value',
        origin: 'span',
        name: ref.name,
        namespace: ref.namespace,
        key: ref.key,
        storedAt: ref.storedAt,
        age: ref.age,
        spanId: span.id,
      });
    }
  }

  for (const [index, ref] of caseCacheRefs.entries()) {
    if (ref.status !== 'hit') continue;
    entries.push({
      id: `case:value:${String(index)}`,
      source: 'value',
      origin: 'caseRoot',
      name: ref.name,
      namespace: ref.namespace,
      key: ref.key,
      storedAt: ref.storedAt,
      age: ref.age,
      spanId: undefined,
    });
  }

  return entries;
}
