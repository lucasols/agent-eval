import type { CaseRow, RunManifest } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  buildEvalScopedRunRows,
  scopeRunCases,
} from '../../../apps/web/src/utils/evalRuns.ts';

describe('eval run rows ui', () => {
  test('builds eval-scoped summaries from filtered case rows instead of the whole run', () => {
    const manifest: RunManifest = {
      id: 'run-1',
      shortId: 'r1',
      status: 'completed',
      startedAt: '2026-04-21T12:00:00.000Z',
      endedAt: '2026-04-21T12:00:03.000Z',
      commitSha: null,
      evalSourceFingerprints: {},
      target: { mode: 'all' },
      trials: 1,
      trialSelection: 'lowestScore',
      cacheMode: 'use',
    };
    const cases: CaseRow[] = [
      {
        caseId: 'alpha-pass',
        evalId: 'alpha',
        status: 'pass',
        latencyMs: 120,
        costUsd: 0.11,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'beta-fail',
        evalId: 'beta',
        status: 'fail',
        latencyMs: 260,
        costUsd: 0.23,
        columns: {},
        trial: 0,
      },
    ];

    const [alphaRow] = buildEvalScopedRunRows([{ manifest, cases }], 'alpha');
    const [betaRow] = buildEvalScopedRunRows([{ manifest, cases }], 'beta');

    expect(alphaRow?.summary).toMatchObject({
      status: 'pass',
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      totalDurationMs: 120,
      cost: { totalUsd: 0.11 },
    });
    expect(betaRow?.summary).toMatchObject({
      status: 'fail',
      totalCases: 1,
      passedCases: 0,
      failedCases: 1,
      totalDurationMs: 260,
      cost: { totalUsd: 0.23 },
    });
  });

  test('scopes drawer run data to the selected eval', () => {
    const cases: CaseRow[] = [
      {
        caseId: 'refund-pass',
        evalId: 'high-value-refund',
        status: 'pass',
        latencyMs: 564,
        costUsd: 0.0014,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'other-fail',
        evalId: 'receipt-fraud-review',
        status: 'fail',
        latencyMs: 1200,
        costUsd: 0.004,
        columns: {},
        trial: 0,
      },
    ];

    const scoped = scopeRunCases({
      cases,
      evals: [
        {
          id: 'high-value-refund',
          filePath:
            'evals/support/refunds/escalations/high-value-refund.eval.ts',
        },
        {
          id: 'receipt-fraud-review',
          filePath:
            'evals/support/refunds/receipts/receipt-fraud-review.eval.ts',
        },
      ],
      selectedEvalId: 'high-value-refund',
      selectedFolderPath: null,
    });

    expect(scoped.label).toBe('high-value-refund');
    expect(scoped.cases).toEqual([
      expect.objectContaining({
        caseId: 'refund-pass',
        evalId: 'high-value-refund',
      }),
    ]);
  });
});
