import type { CaseRow, ScopedCaseSummary } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import { computeStatDisplay } from '#src/utils/evalStats';

const evalSummary = { caseCount: 1, columnDefs: [] };
const latestCases: CaseRow[] = [];

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

test('computeStatDisplay renders cache hits over total cache operations', () => {
  expect(
    computeStatDisplay(
      { kind: 'cacheHits' },
      {
        evalSummary,
        latestSummary: summary({ cacheHits: 4, cacheOperations: 5 }),
        latestCases,
      },
    ),
  ).toEqual({
    label: 'Cache hits',
    aggregateLabel: undefined,
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
        evalSummary,
        latestSummary: summary({ cacheHits: 0, cacheOperations: 3 }),
        latestCases,
      },
    ).hasValue,
  ).toBe(true);
});

test('computeStatDisplay has no cache-hit value when there are no cache operations', () => {
  expect(
    computeStatDisplay(
      { kind: 'cacheHits' },
      {
        evalSummary,
        latestSummary: summary({ cacheHits: 0, cacheOperations: 0 }),
        latestCases,
      },
    ),
  ).toMatchObject({ value: '\u2014', hasValue: false });
});
