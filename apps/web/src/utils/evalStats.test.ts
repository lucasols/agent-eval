import type { CaseRow, ScopedCaseSummary } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import { computeStatDisplay } from '#src/utils/evalStats';

const evalSummary = { caseCount: 1, columnDefs: [] };
const latestCases: CaseRow[] = [];
const defaultContext = {
  evalSummary,
  latestSummary: summary({}),
  latestCases,
  aggregateModeOverride: undefined,
};

function summary(overrides: Partial<ScopedCaseSummary>): ScopedCaseSummary {
  return {
    status: 'pass',
    totalCases: 1,
    passedCases: 1,
    failedCases: 0,
    errorCases: 0,
    cancelledCases: 0,
    pendingCases: 0,
    runningCases: 0,
    totalDurationMs: 10,
    cacheHits: 0,
    cacheOperations: 0,
    ...overrides,
  };
}

function caseRow(
  caseId: string,
  columns: CaseRow['columns'],
  durationMs = 1,
): CaseRow {
  return {
    caseId,
    evalId: 'eval',
    status: 'pass',
    durationMs,
    columns,
    trial: 0,
  };
}

test('computeStatDisplay renders cache hits over total cache operations', () => {
  expect(
    computeStatDisplay(
      { kind: 'cacheHits' },
      {
        ...defaultContext,
        latestSummary: summary({ cacheHits: 4, cacheOperations: 5 }),
      },
    ),
  ).toEqual({
    label: 'Cache hits',
    aggregateLabel: undefined,
    aggregateMode: undefined,
    aggregateTooltip: undefined,
    value: '4/5',
    hasValue: true,
    accent: false,
  });
});

test('computeStatDisplay treats zero cache hits with operations as displayable', () => {
  expect(
    computeStatDisplay(
      { kind: 'cacheHits' },
      {
        ...defaultContext,
        latestSummary: summary({ cacheHits: 0, cacheOperations: 3 }),
      },
    ).hasValue,
  ).toBe(true);
});

test('computeStatDisplay has no cache-hit value when there are no cache operations', () => {
  expect(
    computeStatDisplay(
      { kind: 'cacheHits' },
      {
        ...defaultContext,
        latestSummary: summary({ cacheHits: 0, cacheOperations: 0 }),
      },
    ),
  ).toMatchObject({ value: '\u2014', hasValue: false });
});

test('computeStatDisplay applies a shared aggregate override to column stats', () => {
  expect(
    computeStatDisplay(
      {
        kind: 'column',
        key: 'tokens',
        label: 'Tokens',
        aggregate: 'avg',
        format: 'number',
      },
      {
        evalSummary,
        latestSummary: summary({}),
        latestCases: [
          caseRow('a', { tokens: 100 }),
          caseRow('b', { tokens: 250 }),
        ],
        aggregateModeOverride: 'max',
      },
    ),
  ).toMatchObject({
    label: 'Tokens',
    aggregateLabel: 'max',
    aggregateMode: 'max',
    aggregateTooltip:
      'AVG: 175\nMAX: 250\nMIN: 100\nSUM: 350\nBEST: 250\nWORST: 100',
    value: '250',
    hasValue: true,
  });
});

test('computeStatDisplay aggregates duration like a numeric stat', () => {
  expect(
    computeStatDisplay(
      { kind: 'duration' },
      {
        evalSummary,
        latestSummary: summary({ totalDurationMs: 900 }),
        latestCases: [
          caseRow('a', {}, 100),
          caseRow('b', {}, 250),
          caseRow('c', {}, 550),
        ],
        aggregateModeOverride: 'avg',
      },
    ),
  ).toMatchObject({
    label: 'Duration',
    aggregateLabel: 'avg',
    aggregateMode: 'avg',
    aggregateTooltip:
      'AVG: 300ms\nMAX: 550ms\nMIN: 100ms\nSUM: 900ms\nBEST: 550ms\nWORST: 100ms',
    value: '300ms',
    hasValue: true,
  });
});
