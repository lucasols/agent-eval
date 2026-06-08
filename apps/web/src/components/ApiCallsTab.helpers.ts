import type { ApiCallEntry } from '@agent-evals/shared';

type ParsedEndpointUrl = { host: string; pathname: string };

export type ApiEndpointCallCount = {
  key: string;
  label: string;
  fullLabel: string;
  count: number;
};

export function getMostCalledApiEndpoints(
  entries: ApiCallEntry[],
): ApiEndpointCallCount[] {
  const counts = new Map<string, ApiEndpointCallCount>();
  const omitDomain = shouldOmitCommonDomain(entries);

  for (const entry of entries) {
    const fullLabel = getApiEndpointLabel(entry);
    const existing = counts.get(fullLabel);
    if (existing !== undefined) {
      counts.set(fullLabel, { ...existing, count: existing.count + 1 });
    } else {
      counts.set(fullLabel, {
        key: fullLabel,
        label: getApiEndpointDisplayLabel(entry, omitDomain),
        fullLabel,
        count: 1,
      });
    }
  }

  return [...counts.values()].toSorted(
    (a, b) => b.count - a.count || a.fullLabel.localeCompare(b.fullLabel),
  );
}

export function getApiCallSearchValues(entry: ApiCallEntry): string[] {
  return [
    entry.name,
    getApiEndpointTarget(entry),
    getApiEndpointLabel(entry),
    ...(entry.url === null ? [] : [entry.url]),
  ];
}

export function formatCallCount(value: number): string {
  return `${String(value)} ${value === 1 ? 'call' : 'calls'}`;
}

export function getApiEndpointLabel(entry: ApiCallEntry): string {
  const target = getApiEndpointTarget(entry);
  if (entry.method === null || entry.method.length === 0) return target;
  return `${entry.method.toUpperCase()} ${target}`;
}

function getApiEndpointDisplayLabel(
  entry: ApiCallEntry,
  omitDomain: boolean,
): string {
  const target = getApiEndpointDisplayTarget(entry, omitDomain);
  if (entry.method === null || entry.method.length === 0) return target;
  return `${entry.method.toUpperCase()} ${target}`;
}

function getApiEndpointTarget(entry: ApiCallEntry): string {
  const parsed = parseEndpointUrl(entry.url);
  if (parsed !== null) {
    return `${parsed.host}${entry.routeAlias ?? parsed.pathname}`;
  }
  if (entry.routeAlias !== null) return entry.routeAlias;
  if (entry.url !== null && entry.url.length > 0) {
    return summarizeRawEndpointUrl(entry.url);
  }
  return entry.name;
}

function getApiEndpointDisplayTarget(
  entry: ApiCallEntry,
  omitDomain: boolean,
): string {
  const parsed = parseEndpointUrl(entry.url);
  if (parsed === null) {
    if (entry.routeAlias !== null) return entry.routeAlias;
    if (entry.url !== null && entry.url.length > 0) {
      return summarizeRawEndpointUrl(entry.url);
    }
    return entry.name;
  }
  const pathname = entry.routeAlias ?? parsed.pathname;
  if (omitDomain) return pathname;
  return `${parsed.host}${pathname}`;
}

function shouldOmitCommonDomain(entries: ApiCallEntry[]): boolean {
  let commonHost: string | null = null;

  for (const entry of entries) {
    const parsed = parseEndpointUrl(entry.url);
    if (parsed === null) return false;
    commonHost ??= parsed.host;
    if (parsed.host !== commonHost) return false;
  }

  return commonHost !== null;
}

function parseEndpointUrl(url: string | null): ParsedEndpointUrl | null {
  if (url === null || url.length === 0) return null;
  if (URL.canParse(url)) {
    const parsed = new URL(url);
    if (parsed.host.length > 0) {
      return { host: parsed.host, pathname: parsed.pathname };
    }
  }

  const withoutSearch = stripSearchAndHash(url.trim());
  const slashIndex = withoutSearch.indexOf('/');
  if (slashIndex === -1) return null;

  const firstSegment = withoutSearch.slice(0, slashIndex);
  if (!firstSegment.includes(':') && !firstSegment.includes('.')) return null;

  return { host: firstSegment, pathname: withoutSearch.slice(slashIndex) };
}

function summarizeRawEndpointUrl(url: string): string {
  return stripSearchAndHash(url);
}

function stripSearchAndHash(value: string): string {
  const queryIndex = value.indexOf('?');
  const hashIndex = value.indexOf('#');
  const endIndex = [queryIndex, hashIndex]
    .filter((index) => index !== -1)
    .toSorted((a, b) => a - b)[0];
  return endIndex === undefined ? value : value.slice(0, endIndex);
}
