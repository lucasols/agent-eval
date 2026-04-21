import type { CaseRow, RunManifest } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import { buildEvalScopedRunRows } from '../../../apps/web/src/utils/evalRuns.ts';

describe('eval run rows ui', () => {
  test('builds eval-scoped summaries from filtered case rows instead of the whole run', () => {
    const manifest: RunManifest = {
      id: 'run-1',
      shortId: 'r1',
      status: 'completed',
      startedAt: '2026-04-21T12:00:00.000Z',
      endedAt: '2026-04-21T12:00:03.000Z',
      target: { mode: 'all' },
      trials: 1,
      cacheMode: 'use',
    };
    const cases: CaseRow[] = [
      {
        caseId: 'alpha-pass',
        evalId: 'alpha',
        status: 'pass',
        score: 1,
        latencyMs: 120,
        costUsd: 0.11,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'beta-fail',
        evalId: 'beta',
        status: 'fail',
        score: 0,
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
      averageScore: 1,
      totalDurationMs: 120,
      cost: { totalUsd: 0.11 },
    });
    expect(betaRow?.summary).toMatchObject({
      status: 'fail',
      totalCases: 1,
      passedCases: 0,
      failedCases: 1,
      averageScore: 0,
      totalDurationMs: 260,
      cost: { totalUsd: 0.23 },
    });
  });
});
