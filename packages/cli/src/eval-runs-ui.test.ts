import type { CaseRow, RunManifest } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  buildEvalDebugCliCommand,
  buildEvalRunCliCommand,
} from '../../../apps/web/src/utils/cliCommand.ts';
import {
  buildEvalScopedRunRows,
  scopeRunCases,
} from '../../../apps/web/src/utils/evalRuns.ts';

describe('eval run rows ui', () => {
  test('builds package-manager-specific eval run commands', () => {
    expect(
      buildEvalRunCliCommand({
        packageManager: 'pnpm',
        evalId: 'errored-span-demo',
      }),
    ).toBe('pnpm exec agent-evals run --eval errored-span-demo');
    expect(
      buildEvalRunCliCommand({ packageManager: 'npm', evalId: 'needs quotes' }),
    ).toBe("npm exec agent-evals -- run --eval 'needs quotes'");
  });

  test('builds package-manager-specific eval debug commands', () => {
    expect(
      buildEvalDebugCliCommand({
        packageManager: 'pnpm',
        evalId: 'errored-span-demo',
      }),
    ).toBe('pnpm exec agent-evals run --inspect --eval errored-span-demo');
    expect(
      buildEvalDebugCliCommand({
        packageManager: 'npm',
        evalId: 'needs quotes',
      }),
    ).toBe("npm exec agent-evals -- run --inspect --eval 'needs quotes'");
  });

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
        evalKey: 'evals%2Falpha.eval.ts#alpha',
        status: 'pass',
        durationMs: 120,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'beta-fail',
        evalId: 'beta',
        evalKey: 'evals%2Fbeta.eval.ts#beta',
        status: 'fail',
        durationMs: 260,
        columns: {},
        trial: 0,
      },
    ];

    const [alphaRow] = buildEvalScopedRunRows(
      [{ manifest, cases }],
      'evals%2Falpha.eval.ts#alpha',
    );
    const [betaRow] = buildEvalScopedRunRows(
      [{ manifest, cases }],
      'evals%2Fbeta.eval.ts#beta',
    );

    expect(alphaRow?.summary).toMatchObject({
      status: 'pass',
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      totalDurationMs: 120,
    });
    expect(betaRow?.summary).toMatchObject({
      status: 'fail',
      totalCases: 1,
      passedCases: 0,
      failedCases: 1,
      totalDurationMs: 260,
    });
  });

  test('scopes drawer run data to the selected eval', () => {
    const cases: CaseRow[] = [
      {
        caseId: 'refund-pass',
        evalId: 'high-value-refund',
        evalKey:
          'evals%2Fsupport%2Frefunds%2Fescalations%2Fhigh-value-refund.eval.ts#high-value-refund',
        status: 'pass',
        durationMs: 564,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'other-fail',
        evalId: 'receipt-fraud-review',
        evalKey:
          'evals%2Fsupport%2Frefunds%2Freceipts%2Freceipt-fraud-review.eval.ts#receipt-fraud-review',
        status: 'fail',
        durationMs: 1200,
        columns: {},
        trial: 0,
      },
    ];

    const scoped = scopeRunCases({
      cases,
      evals: [
        {
          id: 'high-value-refund',
          key: 'evals%2Fsupport%2Frefunds%2Fescalations%2Fhigh-value-refund.eval.ts#high-value-refund',
          filePath:
            'evals/support/refunds/escalations/high-value-refund.eval.ts',
        },
        {
          id: 'receipt-fraud-review',
          key: 'evals%2Fsupport%2Frefunds%2Freceipts%2Freceipt-fraud-review.eval.ts#receipt-fraud-review',
          filePath:
            'evals/support/refunds/receipts/receipt-fraud-review.eval.ts',
        },
      ],
      selectedEvalKey:
        'evals%2Fsupport%2Frefunds%2Fescalations%2Fhigh-value-refund.eval.ts#high-value-refund',
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

  test('scopes drawer run data by eval key', () => {
    const cases: CaseRow[] = [
      {
        caseId: 'simple-text',
        evalId: 'refund-workflow',
        evalKey: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
        status: 'pass',
        durationMs: 229,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'other',
        evalId: 'refund-workflow',
        evalKey: 'evals%2Fother-refund.eval.ts#refund-workflow',
        status: 'fail',
        durationMs: 1200,
        columns: {},
        trial: 0,
      },
    ];

    const scoped = scopeRunCases({
      cases,
      evals: [
        {
          id: 'refund-workflow',
          key: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
          filePath: 'evals/refund-workflow.eval.ts',
        },
      ],
      selectedEvalKey: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
      selectedFolderPath: null,
    });

    expect(scoped.label).toBe('refund-workflow');
    expect(scoped.cases).toEqual([
      expect.objectContaining({
        caseId: 'simple-text',
        evalKey: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
      }),
    ]);
  });
});
