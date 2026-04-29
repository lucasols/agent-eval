import {
  cacheStatusSchema,
  traceCacheRefSchema,
  type TraceCacheRef,
} from '../schemas/cache.ts';
import type { EvalTraceSpan } from '../schemas/trace.ts';

/**
 * Single cache activity entry rendered as one row in the case drawer's Cache
 * tab.
 *
 * `action === 'hit'` rows reused an existing persisted cache entry.
 * `action === 'added'` rows came from a miss or refresh that wrote a persisted
 * cache entry during the run. `origin === 'caseRoot'` rows came from
 * `evalTracer.cache(...)` calls made directly from the case body (no
 * surrounding `traceSpan`), which would otherwise be invisible.
 */
export type CacheActivityEntry = {
  id: string;
  source: 'span' | 'value';
  origin: 'span' | 'caseRoot';
  action: 'hit' | 'added';
  status: 'hit' | 'miss' | 'refresh';
  name: string;
  namespace: string;
  key: string;
  storedAt: string | undefined;
  age: number | undefined;
  spanId: string | undefined;
};

/** Cache activity row narrowed to cache hits for compatibility helpers. */
export type CacheHitEntry = CacheActivityEntry & {
  action: 'hit';
  status: 'hit';
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

function readCacheStatus(
  attributes: unknown,
): CacheActivityEntry['status'] | undefined {
  if (!isRecord(attributes)) return undefined;
  const parsed = cacheStatusSchema.safeParse(attributes['cache.status']);
  if (!parsed.success || parsed.data === 'bypass') return undefined;
  return parsed.data;
}

/**
 * Collect every cache hit or cache write recorded for a case run.
 *
 * Walks `spans` for span-level cache activity (`attributes['cache.status']`)
 * and per-span value-cache refs (`attributes['cache.refs']`), then appends
 * spanless value-cache refs persisted on the case scope. Bypasses are skipped
 * because they do not read or write a persisted cache entry.
 */
export function extractCacheEntries(
  spans: EvalTraceSpan[],
  caseCacheRefs: TraceCacheRef[],
): CacheActivityEntry[] {
  const entries: CacheActivityEntry[] = [];

  for (const span of spans) {
    const status = readCacheStatus(span.attributes);
    if (status !== undefined) {
      const key = readString(span.attributes, 'cache.key');
      const namespace = readString(span.attributes, 'cache.namespace');
      if (key !== undefined && namespace !== undefined) {
        const isHit = status === 'hit';
        entries.push({
          id: span.id,
          source: 'span',
          origin: 'span',
          action: isHit ? 'hit' : 'added',
          status,
          name: span.name,
          namespace,
          key,
          storedAt: isHit
            ? readString(span.attributes, 'cache.storedAt')
            : undefined,
          age: isHit ? readNumber(span.attributes, 'cache.age') : undefined,
          spanId: span.id,
        });
      }
    }

    const rawRefs = readArray(span.attributes, 'cache.refs');
    for (const [index, rawRef] of rawRefs.entries()) {
      const parsed = traceCacheRefSchema.safeParse(rawRef);
      if (!parsed.success) continue;
      const ref = parsed.data;
      if (ref.status === 'bypass') continue;
      const isHit = ref.status === 'hit';
      entries.push({
        id: `${span.id}:value:${String(index)}`,
        source: 'value',
        origin: 'span',
        action: isHit ? 'hit' : 'added',
        status: ref.status,
        name: ref.name,
        namespace: ref.namespace,
        key: ref.key,
        storedAt: isHit ? ref.storedAt : undefined,
        age: isHit ? ref.age : undefined,
        spanId: span.id,
      });
    }
  }

  for (const [index, ref] of caseCacheRefs.entries()) {
    if (ref.status === 'bypass') continue;
    const isHit = ref.status === 'hit';
    entries.push({
      id: `case:value:${String(index)}`,
      source: 'value',
      origin: 'caseRoot',
      action: isHit ? 'hit' : 'added',
      status: ref.status,
      name: ref.name,
      namespace: ref.namespace,
      key: ref.key,
      storedAt: isHit ? ref.storedAt : undefined,
      age: isHit ? ref.age : undefined,
      spanId: undefined,
    });
  }

  return entries;
}

/**
 * Collect every `status === 'hit'` cache event recorded for a case run.
 *
 * This compatibility helper returns only rows that reused an existing
 * persisted cache entry. Use `extractCacheEntries(...)` when the UI should
 * include cache misses and refreshes that wrote entries during the run.
 */
export function extractCacheHits(
  spans: EvalTraceSpan[],
  caseCacheRefs: TraceCacheRef[],
): CacheHitEntry[] {
  return extractCacheEntries(spans, caseCacheRefs).filter(isCacheHitEntry);
}

function isCacheHitEntry(entry: CacheActivityEntry): entry is CacheHitEntry {
  return entry.status === 'hit';
}
