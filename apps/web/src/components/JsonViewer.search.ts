import { filterObjectOrArrayKeys } from '@ls-stack/utils/filterObjectOrArrayKeys';
import { resultify } from 't-result';

export type SearchMode = 'text' | 'keys';

type SearchResult = {
  value: unknown;
  isEmpty: boolean;
  message: string | undefined;
};

type TextSearchMatch = { matched: true; value: unknown } | { matched: false };

type IndexedTextSearchMatch = {
  index: number;
  match: Extract<TextSearchMatch, { matched: true }>;
};

export const keyFilterSyntaxTooltip = `Key filter syntax:
Separate patterns with commas or new lines.

Root key: prop
Any depth: **prop
Exact path: prop.nested
Second level: *.prop

Arrays:
prop[0]
prop[*].nested
prop[0-2]
prop[4-*]

Groups:
prop.(id|name|status)
(users|admins)[*].name

Array value filters:
users[%name="John"]
users[%name*="oh"]
users[i%name="john"]
users[%age=30 && %role="admin"]`;

const keyPatternSeparatorRegexp = /[\n,]/;
const originalIndexKey = '__original_index';
const noTextSearchMatch: TextSearchMatch = { matched: false };

export function formatPrimitiveValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[Function]';
  return '[Object]';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKeyFilterable(
  value: unknown,
): value is Record<string, unknown> | Record<string, unknown>[] {
  return isRecord(value) || (Array.isArray(value) && value.every(isRecord));
}

function splitKeyFilterPatterns(query: string): string[] {
  return query
    .split(keyPatternSeparatorRegexp)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isIndexedTextSearchMatch(value: {
  index: number;
  match: TextSearchMatch;
}): value is IndexedTextSearchMatch {
  return value.match.matched;
}

function addOriginalIndex(value: unknown, index: number): unknown {
  if (isRecord(value)) return { [originalIndexKey]: index, ...value };
  return { [originalIndexKey]: index, value };
}

function maybeAddOriginalIndex(
  value: unknown,
  index: number,
  showOriginalIndexes: boolean,
): unknown {
  return showOriginalIndexes ? addOriginalIndex(value, index) : value;
}

function compactFilteredArrays(
  value: unknown,
  showOriginalIndexes: boolean,
): unknown {
  if (Array.isArray(value)) {
    const retainedItems: Array<{ index: number; value: unknown }> = [];

    for (const [index, child] of value.entries()) {
      const compactedChild = compactFilteredArrays(child, showOriginalIndexes);
      if (isEmptyRecord(compactedChild)) continue;
      retainedItems.push({ index, value: compactedChild });
    }

    const arrayWasFiltered = retainedItems.length !== value.length;
    return retainedItems.map((item) =>
      arrayWasFiltered
        ? maybeAddOriginalIndex(item.value, item.index, showOriginalIndexes)
        : item.value,
    );
  }

  if (isRecord(value)) {
    const compactedObject: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(value)) {
      const compactedChild = compactFilteredArrays(child, showOriginalIndexes);
      if (isEmptyRecord(compactedChild)) continue;
      compactedObject[key] = compactedChild;
    }

    return compactedObject;
  }

  return value;
}

function filterTextSearch(
  value: unknown,
  query: string,
  showOriginalIndexes: boolean,
): TextSearchMatch {
  const normalizedQuery = query.toLowerCase();

  function filterValue(current: unknown, path: string[]): TextSearchMatch {
    if (Array.isArray(current)) {
      const matches = current
        .map((child, index) => ({
          index,
          match: filterValue(child, [...path, `[${index}]`]),
        }))
        .filter(isIndexedTextSearchMatch);

      const arrayWasFiltered = matches.length !== current.length;
      const matchedValues = matches.map((child) =>
        arrayWasFiltered
          ? maybeAddOriginalIndex(
              child.match.value,
              child.index,
              showOriginalIndexes,
            )
          : child.match.value,
      );

      return matches.length > 0
        ? { matched: true, value: matchedValues }
        : noTextSearchMatch;
    }

    if (isRecord(current)) {
      const filteredObject: Record<string, unknown> = {};

      for (const [key, child] of Object.entries(current)) {
        const childPath = [...path, key];
        const keyMatches =
          key.toLowerCase().includes(normalizedQuery) ||
          childPath.join('.').toLowerCase().includes(normalizedQuery);

        if (keyMatches) {
          filteredObject[key] = child;
          continue;
        }

        const filteredChild = filterValue(child, childPath);
        if (filteredChild.matched) filteredObject[key] = filteredChild.value;
      }

      return Object.keys(filteredObject).length > 0
        ? { matched: true, value: filteredObject }
        : noTextSearchMatch;
    }

    return formatPrimitiveValue(current).toLowerCase().includes(normalizedQuery)
      ? { matched: true, value: current }
      : noTextSearchMatch;
  }

  return filterValue(value, []);
}

export function resolveSearchResult(
  value: unknown,
  query: string,
  mode: SearchMode,
  showOriginalIndexes: boolean,
): SearchResult {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { value, isEmpty: false, message: undefined };
  }

  if (mode === 'text') {
    const filtered = filterTextSearch(value, trimmedQuery, showOriginalIndexes);
    return !filtered.matched
      ? { value: undefined, isEmpty: true, message: undefined }
      : { value: filtered.value, isEmpty: false, message: undefined };
  }

  if (!isKeyFilterable(value)) {
    return {
      value: undefined,
      isEmpty: true,
      message: 'Key filters support objects and arrays of objects.',
    };
  }

  const patterns = splitKeyFilterPatterns(trimmedQuery);
  const filterResult = resultify((): unknown =>
    filterObjectOrArrayKeys(value, {
      filterKeys: patterns,
      rejectEmptyObjectsInArray: false,
      sortKeys: false,
    }),
  );

  if (filterResult.error) {
    return {
      value: undefined,
      isEmpty: true,
      message: filterResult.error.message,
    };
  }

  const filteredValue = compactFilteredArrays(
    filterResult.value,
    showOriginalIndexes,
  );
  const isEmpty =
    (Array.isArray(filteredValue) && filteredValue.length === 0) ||
    (isRecord(filteredValue) && Object.keys(filteredValue).length === 0);

  return { value: filteredValue, isEmpty, message: undefined };
}
