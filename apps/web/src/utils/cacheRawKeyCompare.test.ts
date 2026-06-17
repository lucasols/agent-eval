import type {
  CacheActivityEntry,
  CaseRow,
  RunManifest,
} from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  getSameEvalCases,
  getSameEvalRuns,
  selectDefaultComparisonCacheEntry,
  selectDefaultComparisonCaseKey,
  selectDefaultComparisonRunId,
  stringifyCanonicalJson,
  type CacheCompareRun,
} from '#src/utils/cacheRawKeyCompare';

function manifest(id: string, startedAt: string): RunManifest {
  return {
    id,
    shortId: id,
    status: 'completed',
    temporary: false,
    startedAt,
    endedAt: startedAt,
    commitSha: null,
    branchName: null,
    evalSourceFingerprints: {},
    target: { mode: 'all' },
    trials: 1,
    trialSelection: 'lowestScore',
    cacheMode: 'use',
  };
}

function caseRow(params: {
  caseId: string;
  evalKey: string;
  caseKey?: string;
}): CaseRow {
  return {
    evalKey: params.evalKey,
    caseKey: params.caseKey,
    caseId: params.caseId,
    evalId: params.evalKey,
    tags: [],
    status: 'pass',
    durationMs: 1,
    costUsd: null,
    columns: {},
    trial: 0,
  };
}

function cacheEntry(params: {
  id: string;
  stored: boolean;
}): CacheActivityEntry {
  return {
    id: params.id,
    source: 'span',
    origin: 'span',
    action: params.stored ? 'added' : 'notStored',
    status: 'miss',
    stored: params.stored,
    name: params.id,
    namespace: 'eval.cache',
    key: params.id,
    storedAt: undefined,
    age: undefined,
    spanId: params.id,
  };
}

describe('cache raw key comparison helpers', () => {
  test('selects the previous same-eval run in newest-first order', () => {
    const runs: CacheCompareRun[] = [
      {
        manifest: manifest('older', '2026-04-01T00:00:00.000Z'),
        cases: [caseRow({ evalKey: 'eval-a', caseId: 'case-1' })],
      },
      {
        manifest: manifest('newest', '2026-04-03T00:00:00.000Z'),
        cases: [caseRow({ evalKey: 'eval-a', caseId: 'case-1' })],
      },
      {
        manifest: manifest('current', '2026-04-02T00:00:00.000Z'),
        cases: [caseRow({ evalKey: 'eval-a', caseId: 'case-1' })],
      },
      {
        manifest: manifest('other-eval', '2026-04-04T00:00:00.000Z'),
        cases: [caseRow({ evalKey: 'eval-b', caseId: 'case-1' })],
      },
    ];

    const sameEvalRuns = getSameEvalRuns(runs, 'eval-a');

    expect(sameEvalRuns.map((run) => run.manifest.id)).toEqual([
      'newest',
      'current',
      'older',
    ]);
    expect(
      selectDefaultComparisonRunId({
        runs: sameEvalRuns,
        currentRunId: 'current',
      }),
    ).toBe('older');
  });

  test('selects the same case key and falls back to the first same-eval case', () => {
    const run: CacheCompareRun = {
      manifest: manifest('run', '2026-04-01T00:00:00.000Z'),
      cases: [
        caseRow({ evalKey: 'eval-b', caseId: 'ignored' }),
        caseRow({
          evalKey: 'eval-a',
          caseId: 'first',
          caseKey: 'eval-a#first',
        }),
        caseRow({
          evalKey: 'eval-a',
          caseId: 'second',
          caseKey: 'eval-a#second',
        }),
      ],
    };
    const cases = getSameEvalCases(run, 'eval-a');

    expect(
      selectDefaultComparisonCaseKey({
        cases,
        currentCaseKey: 'eval-a#second',
      }),
    ).toBe('eval-a#second');
    expect(
      selectDefaultComparisonCaseKey({ cases, currentCaseKey: 'missing' }),
    ).toBe('eval-a#first');
  });

  test('selects the same cache index and falls back to the first stored entry', () => {
    expect(
      selectDefaultComparisonCacheEntry({
        entries: [
          cacheEntry({ id: 'first', stored: true }),
          cacheEntry({ id: 'second', stored: true }),
        ],
        currentCacheIndex: 1,
      })?.id,
    ).toBe('second');

    expect(
      selectDefaultComparisonCacheEntry({
        entries: [
          cacheEntry({ id: 'first', stored: false }),
          cacheEntry({ id: 'second', stored: true }),
        ],
        currentCacheIndex: 0,
      })?.id,
    ).toBe('second');
  });

  test('canonical JSON recursively sorts object keys and preserves array order', () => {
    expect(
      stringifyCanonicalJson({
        z: 1,
        a: { b: 2, a: 1 },
        list: [{ y: true, x: false }, 'kept'],
      }),
    ).toMatchInlineSnapshot(`
      "{
        "a": {
          "a": 1,
          "b": 2
        },
        "list": [
          {
            "x": false,
            "y": true
          },
          "kept"
        ],
        "z": 1
      }"
    `);
  });
});
