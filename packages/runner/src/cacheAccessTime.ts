import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resultify } from 't-result';
import { z } from 'zod';

const defaultLastAccessedAtUpdateIntervalMs = 4 * 60 * 60 * 1000;

export function normalizeLastAccessedAtUpdateIntervalMs(
  value: number | undefined,
): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return defaultLastAccessedAtUpdateIntervalMs;
  }
  return Math.floor(value);
}

export function cacheAccessSortTime(entry: {
  storedAt: string;
  lastAccessedAt: string | null;
}): string {
  return entry.lastAccessedAt ?? entry.storedAt;
}

export function shouldRefreshLastAccessedAt(params: {
  lastAccessedAt: string | null;
  nowMs: number;
  updateIntervalMs: number;
}): boolean {
  return (
    params.lastAccessedAt === null ||
    params.nowMs - Date.parse(params.lastAccessedAt) > params.updateIntervalMs
  );
}

/**
 * Path of the machine-local sidecar holding one namespace's cache access
 * times. It sits next to the cache dir (`.agent-evals/cache-access` for the
 * default cache) so hits never rewrite the committed cache index files.
 */
export function cacheAccessTimesPath(
  cacheDir: string,
  namespaceHash: string,
): string {
  return join(`${cacheDir}-access`, `${namespaceHash}.json`);
}

/** Read `key -> lastAccessedAt` pairs from an access-time sidecar. */
export async function readCacheAccessTimes(
  filePath: string,
): Promise<Record<string, string>> {
  const raw = await resultify(() => readFile(filePath, 'utf8'));
  if (raw.error) return {};
  const parsed = resultify(() =>
    accessTimesSchema.parse(JSON.parse(raw.value)),
  );
  return parsed.error ? {} : parsed.value.entries;
}

/** Replace an access-time sidecar, deleting it when no entries remain. */
export async function writeCacheAccessTimes(
  filePath: string,
  entries: Record<string, string>,
): Promise<void> {
  if (Object.keys(entries).length === 0) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid.toString()}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify({ version: 1, entries }, null, 2));
  await rename(tmpPath, filePath);
}

/** Return the most recent of two ISO access timestamps. */
export function latestAccessTime(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return a > b ? a : b;
}

const accessTimesSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.string()),
});
