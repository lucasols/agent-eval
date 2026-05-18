import {
  evalAssert,
  evalExpect,
  evalTracer,
  isInEvalScope,
  setEvalOutput,
} from '@agent-evals/sdk';
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

test('runCase reports evalAssert usage inside deriveFromTracing as a case error', async () => {
  const result = await runDeriveCase({
    evalDef: {
      id: 'derive-assertion-usage-error-eval',
      execute: async () => {
        await evalTracer.span(
          { kind: 'tool', name: 'lookup-customer' },
          () => {},
        );
      },
      deriveFromTracing: ({ trace }) => {
        evalAssert(
          trace.hasToolCallSpan('lookup-customer'),
          'deriveFromTracing should not assert',
        );
        return { derived: true };
      },
      tracingAssertions: () => {
        throw new Error('tracingAssertions should not run after derive error');
      },
      scores: {
        shouldNotRun: () => {
          throw new Error('score should not run after derive error');
        },
      },
    },
  });

  expect(result.caseRowUpdate.status).toBe('error');
  expect(result.caseDetail.assertionFailures).toEqual([]);
  expect(result.caseDetail.assertions).toEqual([]);
  expect(result.caseDetail.columns.derived).toBeUndefined();
  expect(result.caseDetail.columns.shouldNotRun).toBeUndefined();
  expect(result.caseDetail.error).toMatchObject({
    name: 'EvalRuntimeUsageError',
    message:
      'evalAssert(...) cannot be used inside deriveFromTracing. Use tracingAssertions for trace-derived assertions.',
  });
});

test('runCase supports trace-derived assertions and trace tree helpers', async () => {
  const result = await runDeriveCase({
    evalDef: {
      id: 'tracing-assertions-eval',
      execute: async () => {
        await evalTracer.span(
          { kind: 'agent', name: 'refund-agent' },
          async () => {
            await evalTracer.span(
              { kind: 'tool', name: 'lookup-customer' },
              () => {},
            );
            await evalTracer.span(
              { kind: 'tool', name: 'submit-refund' },
              () => {},
            );
          },
        );
      },
      tracingAssertions: ({ trace }) => {
        evalExpect(isInEvalScope()).toBe('tracingAssertions');
        evalExpect(trace.findSpans('lookup-customer')).toHaveLength(1);
        evalExpect(trace.findToolCallSpans()).toHaveLength(2);
        evalExpect(trace.listToolCallSpanNames()).toEqual([
          'lookup-customer',
          'submit-refund',
        ]);
        evalAssert(
          trace.hasToolCallSpan('submit-refund'),
          'refund submission tool should be called',
        );
        evalExpect(trace.listSpanNamesDfs()).toEqual([
          'refund-agent',
          'lookup-customer',
          'submit-refund',
        ]);
      },
    },
  });

  expect(result.caseRowUpdate.status).toBe('pass');
  expect(result.caseDetail.assertions).toEqual([
    { message: 'refund submission tool should be called', status: 'pass' },
  ]);
});

test('runCase records tracingAssertions failures and skips scores', async () => {
  const result = await runDeriveCase({
    evalDef: {
      id: 'tracing-assertions-failure-eval',
      execute: async () => {
        await evalTracer.span(
          { kind: 'tool', name: 'lookup-customer' },
          () => {},
        );
      },
      tracingAssertions: ({ trace }) => {
        evalAssert(
          trace.hasToolCallSpan('submit-refund'),
          'refund submission tool should be called',
        );
      },
      scores: {
        shouldNotRun: () => {
          throw new Error(
            'score should not run after tracing assertion failure',
          );
        },
      },
    },
  });

  expect(result.caseRowUpdate.status).toBe('fail');
  expect(result.caseDetail.assertionFailures[0]?.message).toBe(
    'refund submission tool should be called',
  );
  expect(result.caseDetail.columns.shouldNotRun).toBeUndefined();
});

test('runCase runs global tracingAssertions before eval-level tracingAssertions', async () => {
  const seen: string[] = [];
  const result = await runDeriveCase({
    globalTracingAssertions: ({ trace }) => {
      seen.push('global');
      evalAssert(
        trace.hasSpan('lookup-customer'),
        'global tracing assertion should see spans',
      );
    },
    evalDef: {
      id: 'global-tracing-assertions-eval',
      execute: async () => {
        await evalTracer.span(
          { kind: 'tool', name: 'lookup-customer' },
          () => {},
        );
      },
      tracingAssertions: ({ trace }) => {
        seen.push('eval');
        evalAssert(
          trace.hasToolCallSpan('lookup-customer'),
          'eval tracing assertion should see tool spans',
        );
      },
    },
  });

  expect(result.caseRowUpdate.status).toBe('pass');
  expect(seen).toEqual(['global', 'eval']);
  expect(result.caseDetail.assertions).toEqual([
    { message: 'global tracing assertion should see spans', status: 'pass' },
    { message: 'eval tracing assertion should see tool spans', status: 'pass' },
  ]);
});
