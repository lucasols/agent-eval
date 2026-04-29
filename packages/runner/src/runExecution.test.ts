import {
  evalTracer,
  isInEvalScope,
  nextEvalId,
  setEvalOutput,
  startEvalBackgroundJob,
  z,
} from '@agent-evals/sdk';
import { expect, test } from 'vitest';
import { buildScopedEvalIdPrefix, runCase } from './runExecution.ts';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

test('runCase reports execute, derive, outputs schema, and scorer phases', async () => {
  const observedScopes: (string | null)[] = [];

  const result = await runCase({
    evalDef: {
      id: 'runtime-scope-eval',
      cases: [{ id: 'case-one', input: {} }],
      outputsSchema: z
        .object({ derivedScope: z.string(), executeScope: z.string() })
        .superRefine(() => {
          observedScopes.push(isInEvalScope());
        }),
      execute: () => {
        const scope = isInEvalScope();
        observedScopes.push(scope);
        setEvalOutput('executeScope', scope);
      },
      deriveFromTracing: () => {
        const scope = isInEvalScope();
        observedScopes.push(scope);
        return { derivedScope: scope ?? 'missing' };
      },
      scores: {
        phase: {
          compute: () => {
            const scope = isInEvalScope();
            observedScopes.push(scope);
            return scope === 'scorer' ? 1 : 0;
          },
        },
      },
    },
    evalId: 'runtime-scope-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/runtime-scope.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  expect(observedScopes).toEqual(['eval', 'derive', 'outputsSchema', 'scorer']);
  expect(result.caseDetail.columns).toMatchObject({
    derivedScope: 'derive',
    executeScope: 'eval',
    phase: 1,
  });
});

test('runCase waits for fire-and-forget spans before finalizing traces', async () => {
  const result = await runCase({
    evalDef: {
      id: 'background-span-eval',
      cases: [{ id: 'case-one', input: {} }],
      execute: () => {
        void evalTracer.span({ kind: 'tool', name: 'late-span' }, async () => {
          await delay(5);
          setEvalOutput('lateOutput', 'recorded');
        });
      },
    },
    evalId: 'background-span-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/background-span.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  const span = result.caseDetail.trace.find(
    (item) => item.name === 'late-span',
  );
  expect(span?.status).toBe('ok');
  expect(span?.endedAt).not.toBeNull();
  expect(result.caseDetail.columns.lateOutput).toBe('recorded');
});

test('runCase waits for explicit and nested background jobs', async () => {
  const result = await runCase({
    evalDef: {
      id: 'background-job-eval',
      cases: [{ id: 'case-one', input: {} }],
      execute: () => {
        void startEvalBackgroundJob(
          (async () => {
            await delay(5);
            setEvalOutput('jobOutput', 'recorded');
            void evalTracer.span(
              { kind: 'tool', name: 'nested-background-span' },
              async () => {
                await delay(5);
                setEvalOutput('nestedOutput', 'recorded');
              },
            );
          })(),
        );
      },
    },
    evalId: 'background-job-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/background-job.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  expect(result.caseDetail.columns.jobOutput).toBe('recorded');
  expect(result.caseDetail.columns.nestedOutput).toBe('recorded');
  expect(
    result.caseDetail.trace.find(
      (item) => item.name === 'nested-background-span',
    )?.status,
  ).toBe('ok');
});

test('background span rejections stay on the span without case-level errors', async () => {
  const result = await runCase({
    evalDef: {
      id: 'background-error-eval',
      cases: [{ id: 'case-one', input: {} }],
      execute: () => {
        void evalTracer.span(
          { kind: 'tool', name: 'rejected-background-span' },
          async () => {
            await delay(5);
            throw new Error('background span failed');
          },
        );
      },
    },
    evalId: 'background-error-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/background-error.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  const span = result.caseDetail.trace.find(
    (item) => item.name === 'rejected-background-span',
  );
  expect(span?.status).toBe('error');
  expect(span?.error?.message).toBe('background span failed');
  expect(result.caseDetail.assertionFailures).toEqual([]);
  expect(result.caseDetail.error).toBeNull();
  expect(result.caseDetail.status).toBe('pass');
});

test('evals can opt out of waiting for background jobs', async () => {
  const result = await runCase({
    evalDef: {
      id: 'background-opt-out-eval',
      waitForBackgroundJobs: false,
      cases: [{ id: 'case-one', input: {} }],
      execute: () => {
        void evalTracer.span(
          { kind: 'tool', name: 'unwaited-background-span' },
          async () => {
            await delay(50);
            setEvalOutput('lateOutput', 'too-late');
          },
        );
      },
    },
    evalId: 'background-opt-out-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/background-opt-out.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  expect(result.caseDetail.columns.lateOutput).toBeUndefined();
  expect(
    result.caseDetail.trace.find(
      (item) => item.name === 'unwaited-background-span',
    )?.status,
  ).toBe('running');
});

test('spans can opt out of background waiting individually', async () => {
  const result = await runCase({
    evalDef: {
      id: 'background-span-opt-out-eval',
      cases: [{ id: 'case-one', input: {} }],
      execute: () => {
        void evalTracer.span(
          {
            kind: 'tool',
            name: 'unwaited-background-span',
            waitForBackgroundJob: false,
          },
          async () => {
            await delay(50);
            setEvalOutput('spanOutput', 'too-late');
          },
        );

        void startEvalBackgroundJob(
          (async () => {
            await delay(5);
            setEvalOutput('jobOutput', 'recorded');
          })(),
        );
      },
    },
    evalId: 'background-span-opt-out-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/background-span-opt-out.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  expect(result.caseDetail.columns.jobOutput).toBe('recorded');
  expect(result.caseDetail.columns.spanOutput).toBeUndefined();
  expect(
    result.caseDetail.trace.find(
      (item) => item.name === 'unwaited-background-span',
    )?.status,
  ).toBe('running');
});
