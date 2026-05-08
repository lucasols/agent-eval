import type { CaseRow } from '@agent-evals/shared';
import { deriveScopedSummaryFromCases } from '@agent-evals/shared';
import { expect, test } from 'vitest';

function caseRow(overrides: Partial<CaseRow>): CaseRow {
  return {
    caseId: 'case',
    evalId: 'eval',
    status: 'pass',
    durationMs: 1,
    columns: {},
    trial: 0,
    ...overrides,
  };
}

test('deriveScopedSummaryFromCases sums cache hits and operations while treating legacy rows as zero', () => {
  const summary = deriveScopedSummaryFromCases({
    caseRows: [
      caseRow({ caseId: 'first', cacheHits: 2, cacheOperations: 4 }),
      caseRow({ caseId: 'legacy' }),
      caseRow({ caseId: 'second', cacheHits: 3, cacheOperations: 5 }),
    ],
  });

  expect(summary.cacheHits).toBe(5);
  expect(summary.cacheOperations).toBe(9);
});
