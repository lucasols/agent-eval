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
