import { evalTracer, nextEvalId, setEvalOutput } from '@agent-evals/sdk';
import { expect, test } from 'vitest';
import { buildScopedEvalIdPrefix, runCase } from './runExecution.ts';

test('buildScopedEvalIdPrefix includes the workspace-relative eval file path', () => {
  expect(
    buildScopedEvalIdPrefix({
      evalId: 'duplicate-id',
      evalFilePath: '/repo/evals/support/refund.eval.ts',
      caseId: 'case-a',
      workspaceRoot: '/repo',
    }),
  ).toBe('duplicate-id-evals-support-refund-eval-ts-case-a');

  expect(
    buildScopedEvalIdPrefix({
      evalId: 'duplicate-id',
      evalFilePath: '/repo/evals/returns/refund.eval.ts',
      caseId: 'case-a',
      workspaceRoot: '/repo',
    }),
  ).toBe('duplicate-id-evals-returns-refund-eval-ts-case-a');
});

test('runCase gives execute and score scopes distinct deterministic eval IDs', async () => {
  const result = await runCase({
    evalDef: {
      id: 'scoped-id-eval',
      cases: [{ id: 'case-one', input: {} }],
      execute: () => {
        setEvalOutput('generatedIds', [nextEvalId(), nextEvalId()]);
      },
      scores: {
        quality: {
          compute: async () => {
            await evalTracer.span(
              { kind: 'scorer', name: nextEvalId() },
              () => undefined,
            );
            return 1;
          },
        },
      },
    },
    evalId: 'scoped-id-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/scoped-id.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  const prefix = 'scoped-id-eval-evals-support-scoped-id-eval-ts-case-one';

  expect(result.caseDetail.columns.generatedIds).toBe(
    `["${prefix}-1","${prefix}-2"]`,
  );
  expect(result.caseDetail.columns.quality).toBe(1);
  expect(
    result.caseDetail.scoringTraces?.quality?.trace.map((span) => span.name),
  ).toEqual([`${prefix}-score-quality-1`]);
});
