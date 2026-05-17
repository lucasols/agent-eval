import type { EvalSummary } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import { filterEvalsByTags, getTagBreakdown } from '#src/utils/buildEvalTree';

function evalFixture(
  key: string,
  tags: string[] | undefined,
  overrides: Partial<EvalSummary> = {},
): EvalSummary {
  return {
    key,
    id: key,
    filePath: `${key}.eval.ts`,
    stale: false,
    outdated: false,
    freshnessStatus: 'fresh',
    latestRunAt: null,
    latestRunCommitSha: null,
    currentCommitSha: null,
    columnDefs: [],
    caseCount: 1,
    lastRunStatus: 'pass',
    ...(tags ? { tags } : {}),
    ...overrides,
  };
}

test('filterEvalsByTags returns input untouched when no tags are selected', () => {
  const evals = [evalFixture('a', ['refunds']), evalFixture('b', undefined)];
  expect(filterEvalsByTags(evals, new Set())).toBe(evals);
});

test('filterEvalsByTags keeps evals that include any selected tag (OR)', () => {
  const evals = [
    evalFixture('a', ['refunds', 'media']),
    evalFixture('b', ['playground']),
    evalFixture('c', ['playground', 'slow']),
    evalFixture('d', undefined),
  ];
  const filtered = filterEvalsByTags(evals, new Set(['refunds', 'slow']));
  expect(filtered.map((ev) => ev.key)).toEqual(['a', 'c']);
});

test('filterEvalsByTags drops evals without any tags when filters are active', () => {
  const evals = [
    evalFixture('a', ['refunds']),
    evalFixture('b', []),
    evalFixture('c', undefined),
  ];
  const filtered = filterEvalsByTags(evals, new Set(['refunds']));
  expect(filtered.map((ev) => ev.key)).toEqual(['a']);
});

test('getTagBreakdown counts unique tags and sorts by count then name', () => {
  const evals = [
    evalFixture('a', ['refunds', 'media']),
    evalFixture('b', ['refunds']),
    evalFixture('c', ['playground', 'media']),
    evalFixture('d', ['playground', 'slow']),
    evalFixture('e', undefined),
  ];
  expect(getTagBreakdown(evals)).toEqual([
    { tag: 'media', count: 2 },
    { tag: 'playground', count: 2 },
    { tag: 'refunds', count: 2 },
    { tag: 'slow', count: 1 },
  ]);
});

test('getTagBreakdown returns an empty list when no tags are present', () => {
  expect(getTagBreakdown([evalFixture('a', undefined)])).toEqual([]);
});
