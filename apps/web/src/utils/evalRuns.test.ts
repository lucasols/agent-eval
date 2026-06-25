import type { CaseRow, ColumnDef, RunManifest } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import {
  buildEvalScopedRunRows,
  getManualScoreAwareColumnDefs,
  getManualScoreAwareCaseDisplayStatus,
} from '#src/utils/evalRuns';

const manualScoreColumn: ColumnDef = {
  key: 'review',
  label: 'Review',
  kind: 'number',
  format: 'passFail',
  isScore: true,
  isManualScore: true,
  passThreshold: 0.5,
};

const manifest: RunManifest = {
  id: 'run-1',
  shortId: 'r1',
  status: 'completed',
  temporary: false,
  startedAt: '2026-04-21T12:00:00.000Z',
  endedAt: '2026-04-21T12:00:01.000Z',
  commitSha: null,
  branchName: null,
  evalSourceFingerprints: { 'evals%2Fmanual.eval.ts#manual': 'fingerprint' },
  target: { mode: 'all' },
  trials: 1,
  trialSelection: 'lowestScore',
  cacheMode: 'use',
};

function caseRow(columns: CaseRow['columns']): CaseRow {
  return {
    caseId: 'case-1',
    evalId: 'manual',
    evalKey: 'evals%2Fmanual.eval.ts#manual',
    status: 'pass',
    durationMs: 100,
    columns,
    trial: 0,
  };
}

test('buildEvalScopedRunRows displays pending manual scores as unscored', () => {
  const [row] = buildEvalScopedRunRows(
    [{ manifest, cases: [caseRow({ review: null })] }],
    'evals%2Fmanual.eval.ts#manual',
    [manualScoreColumn],
  );

  expect(row?.summary).toMatchObject({
    status: 'unscored',
    totalCases: 1,
    passedCases: 0,
    pendingCases: 1,
  });
});

test('buildEvalScopedRunRows recovers old runs with missing manual score definitions', () => {
  const [row] = buildEvalScopedRunRows(
    [{ manifest, cases: [caseRow({ review: null })] }],
    'evals%2Fmanual.eval.ts#manual',
    [],
  );

  expect(row?.summary).toMatchObject({
    status: 'unscored',
    totalCases: 1,
    passedCases: 0,
    pendingCases: 1,
  });
});

test('buildEvalScopedRunRows leaves filled manual scores as normal pass results', () => {
  const [row] = buildEvalScopedRunRows(
    [{ manifest, cases: [caseRow({ review: 1 })] }],
    'evals%2Fmanual.eval.ts#manual',
    [manualScoreColumn],
  );

  expect(row?.summary).toMatchObject({
    status: 'pass',
    totalCases: 1,
    passedCases: 1,
    pendingCases: 0,
  });
});

test('getManualScoreAwareColumnDefs recovers null columns as manual score columns', () => {
  expect(
    getManualScoreAwareColumnDefs({
      columnDefs: [{ key: 'review', label: 'Review', kind: 'string' }],
      columns: { review: null },
    }),
  ).toEqual([
    {
      key: 'review',
      label: 'Review',
      kind: 'number',
      isScore: true,
      isManualScore: true,
    },
  ]);
});

test('getManualScoreAwareCaseDisplayStatus only marks manual-score gaps unscored', () => {
  expect(
    getManualScoreAwareCaseDisplayStatus({
      caseRow: caseRow({ review: null }),
      columnDefs: [manualScoreColumn],
    }),
  ).toBe('unscored');

  expect(
    getManualScoreAwareCaseDisplayStatus({
      caseRow: caseRow({}),
      columnDefs: [],
    }),
  ).toBe('pass');
});
