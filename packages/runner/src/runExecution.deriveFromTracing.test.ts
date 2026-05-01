import { evalTracer, setEvalOutput } from '@agent-evals/sdk';
import { expect, test } from 'vitest';
import { runCase } from './runExecution.ts';

type RunCaseOverrides = Partial<Parameters<typeof runCase>[0]>;

async function runDeriveCase(overrides: RunCaseOverrides = {}) {
  return await runCase({
    evalDef: { id: 'derive-eval', execute: () => {} },
    evalId: 'derive-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    globalRemoveDefaultConfig: true,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/derive.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
    ...overrides,
  });
}

test('runCase supports eval-level keyed deriveFromTracing', async () => {
  const result = await runDeriveCase({
    evalDef: {
      id: 'keyed-derive-eval',
      execute: async () => {
        setEvalOutput('runtimeWins', 'from runtime');
        await evalTracer.span({ kind: 'tool', name: 'lookup' }, () => {});
        await evalTracer.span({ kind: 'tool', name: 'audit' }, () => {});
      },
      deriveFromTracing: {
        toolCalls: ({ trace }) => trace.findSpansByKind('tool').length,
        omitted: () => undefined,
        runtimeWins: () => 'from derive',
      },
    },
  });

  expect(result.caseDetail.columns.toolCalls).toBe(2);
  expect(result.caseDetail.columns.omitted).toBeUndefined();
  expect(result.caseDetail.columns.runtimeWins).toBe('from runtime');
});

test('runCase applies global deriveFromTracing before eval-level derivations', async () => {
  const result = await runDeriveCase({
    globalDeriveFromTracing: {
      runtimeWins: () => 'from global derive',
      sharedMetric: () => 'from global derive',
      globalOnly: ({ trace }) => trace.findSpansByKind('tool').length,
      omitted: () => undefined,
    },
    evalDef: {
      id: 'global-keyed-derive-eval',
      execute: async () => {
        setEvalOutput('runtimeWins', 'from runtime');
        await evalTracer.span({ kind: 'tool', name: 'lookup' }, () => {});
      },
      deriveFromTracing: {
        sharedMetric: () => 'from eval derive',
        evalOnly: () => 'from eval derive',
      },
    },
  });

  expect(result.caseDetail.columns.runtimeWins).toBe('from runtime');
  expect(result.caseDetail.columns.sharedMetric).toBe('from global derive');
  expect(result.caseDetail.columns.globalOnly).toBe(1);
  expect(result.caseDetail.columns.evalOnly).toBe('from eval derive');
  expect(result.caseDetail.columns.omitted).toBeUndefined();
});

test('runCase records keyed deriveFromTracing failures as assertion failures', async () => {
  const result = await runDeriveCase({
    globalDeriveFromTracing: {
      broken: () => {
        throw new Error('boom');
      },
    },
  });

  expect(result.caseRowUpdate.status).toBe('fail');
  expect(result.caseDetail.assertionFailures[0]?.message).toBe(
    'deriveFromTracing threw: boom',
  );
});
