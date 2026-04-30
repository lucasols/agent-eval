import {
  configureEvalRunLogs,
  evalSpan,
  evalLog,
  evalTracer,
  isInEvalScope,
  nextEvalId,
  setEvalOutput,
  startEvalBackgroundJob,
  z,
  type CacheAdapter,
} from '@agent-evals/sdk';
import { resolveLlmCallsConfig, type CacheEntry } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import { buildScopedEvalIdPrefix, runCase } from './runExecution.ts';

type RunCaseOverrides = Partial<Parameters<typeof runCase>[0]>;

async function runDefaultUsageCase(overrides: RunCaseOverrides = {}) {
  return await runCase({
    evalDef: {
      id: 'default-usage-eval',
      execute: async () => {
        await evalTracer.span({ kind: 'llm', name: 'answer' }, () => {
          evalSpan.setAttributes({
            model: 'gpt-4o-mini',
            provider: 'openai',
            usage: {
              inputTokens: 100,
              outputTokens: 40,
              cachedInputTokens: 10,
              cacheCreationInputTokens: 20,
              reasoningTokens: 5,
            },
          });
        });
        await evalTracer.span({ kind: 'api', name: 'lookup' }, () => {
          evalSpan.setAttributes({
            method: 'GET',
            url: 'https://example.test/customers/123',
            statusCode: 200,
          });
        });
      },
    },
    evalId: 'default-usage-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    llmCallsConfig: resolveLlmCallsConfig({
      pricing: [
        {
          model: 'gpt-4o-mini',
          provider: 'openai',
          inputUsdPerMillion: 2,
          outputUsdPerMillion: 10,
          cachedInputUsdPerMillion: 0.2,
          cacheCreationInputUsdPerMillion: 2.5,
          reasoningUsdPerMillion: 20,
        },
      ],
    }),
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/default-usage.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
    ...overrides,
  });
}

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

test('runCase derives default usage outputs from trace spans', async () => {
  const result = await runDefaultUsageCase();

  expect(result.caseDetail.columns).toMatchObject({
    apiCalls: 1,
    llmTurns: 1,
    inputTokens: 100,
    outputTokens: 40,
    cachedInputTokens: 10,
    cacheCreationInputTokens: 20,
    reasoningTokens: 5,
    totalTokens: 170,
  });
  expect(result.caseDetail.columns.costUsd).toBeCloseTo(0.000752);
  expect(typeof result.caseDetail.columns.llmLatencyMs).toBe('number');
});

test('runCase does not overwrite authored outputs with default usage', async () => {
  const result = await runDefaultUsageCase({
    evalDef: {
      id: 'default-usage-eval',
      execute: async () => {
        setEvalOutput('costUsd', 42);
        await evalTracer.span({ kind: 'llm', name: 'answer' }, () => {
          evalSpan.setAttributes({
            model: 'gpt-4o-mini',
            provider: 'openai',
            usage: { inputTokens: 100, outputTokens: 40 },
          });
        });
      },
    },
  });

  expect(result.caseDetail.columns.costUsd).toBe(42);
  expect(result.caseDetail.columns.llmTurns).toBe(1);
});

test('runCase supports global and per-eval removal of default usage', async () => {
  const globallyRemoved = await runDefaultUsageCase({
    globalRemoveDefaultConfig: true,
  });
  expect(globallyRemoved.caseDetail.columns.apiCalls).toBeUndefined();
  expect(globallyRemoved.caseDetail.columns.llmTurns).toBeUndefined();
  expect(globallyRemoved.caseDetail.columns.costUsd).toBeUndefined();

  const partiallyRemoved = await runDefaultUsageCase({
    evalDef: {
      id: 'default-usage-eval',
      removeDefaultConfig: ['apiCalls', 'costUsd'],
      execute: async () => {
        await evalTracer.span({ kind: 'llm', name: 'answer' }, () => {
          evalSpan.setAttributes({
            model: 'gpt-4o-mini',
            provider: 'openai',
            usage: { inputTokens: 100, outputTokens: 40 },
          });
        });
        await evalTracer.span({ kind: 'api', name: 'lookup' }, () => {
          evalSpan.setAttribute('url', 'https://example.test/customers/123');
        });
      },
    },
  });
  expect(partiallyRemoved.caseDetail.columns.apiCalls).toBeUndefined();
  expect(partiallyRemoved.caseDetail.columns.costUsd).toBeUndefined();
  expect(partiallyRemoved.caseDetail.columns.llmTurns).toBe(1);
});

test('runCase validates typed outputs schema after default outputs are added', async () => {
  const result = await runDefaultUsageCase({
    evalDef: {
      id: 'default-usage-eval',
      outputsSchema: z.object({
        apiCalls: z.number(),
        costUsd: z.number(),
        llmTurns: z.number(),
        response: z.string(),
      }),
      execute: async () => {
        setEvalOutput('response', 'ok');
        await evalTracer.span({ kind: 'llm', name: 'answer' }, () => {
          evalSpan.setAttributes({
            model: 'gpt-4o-mini',
            provider: 'openai',
            usage: { inputTokens: 100, outputTokens: 40 },
          });
        });
        await evalTracer.span({ kind: 'api', name: 'lookup' }, () => {
          evalSpan.setAttribute('url', 'https://example.test/customers/123');
        });
      },
    },
  });

  expect(result.caseDetail.status).toBe('pass');
  expect(result.caseDetail.assertionFailures).toEqual([]);
  expect(result.caseDetail.columns.apiCalls).toBe(1);
  expect(result.caseDetail.columns.costUsd).toBeCloseTo(0.0006);
  expect(result.caseDetail.columns.llmTurns).toBe(1);
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

test('runCase stores manual and console logs with phase metadata', async () => {
  configureEvalRunLogs({ captureConsole: true });

  const result = await runCase({
    evalDef: {
      id: 'logs-eval',
      cases: [{ id: 'case-one', input: {} }],
      outputsSchema: z.object({ ok: z.boolean() }).superRefine(() => {
        evalLog('warning', 'schema warning');
      }),
      execute: () => {
        evalLog('info', 'manual %s', 'entry');
        console.warn('console warning', { id: 123 });
        setEvalOutput('ok', true);
      },
      deriveFromTracing: () => {
        console.info('derive info');
        return {};
      },
      scores: {
        quality: {
          compute: () => {
            evalLog('error', 'score note');
            return 1;
          },
        },
      },
    },
    evalId: 'logs-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/logs.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  expect(
    result.caseDetail.logs.map((entry) => ({
      level: entry.level,
      phase: entry.phase,
      message: entry.message,
      args: entry.args,
      source: entry.source,
      truncated: entry.truncated,
    })),
  ).toEqual([
    {
      level: 'info',
      phase: 'eval',
      message: 'manual entry',
      args: ['manual %s', 'entry'],
      source: undefined,
      truncated: false,
    },
    {
      level: 'warn',
      phase: 'eval',
      message: 'console warning { id: 123 }',
      args: ['console warning', { id: 123 }],
      source: undefined,
      truncated: false,
    },
    {
      level: 'info',
      phase: 'derive',
      message: 'derive info',
      args: ['derive info'],
      source: undefined,
      truncated: false,
    },
    {
      level: 'warn',
      phase: 'outputsSchema',
      message: 'schema warning',
      args: ['schema warning'],
      source: undefined,
      truncated: false,
    },
    {
      level: 'error',
      phase: 'scorer',
      message: 'score note',
      args: ['score note'],
      source: 'quality',
      truncated: false,
    },
  ]);
  for (const entry of result.caseDetail.logs) {
    expect(entry.location?.file).toContain('runExecution.test.ts');
    expect(typeof entry.location?.line).toBe('number');
    expect(typeof entry.location?.column).toBe('number');
  }
  for (const entry of result.caseDetail.logs) {
    expect(entry.timestamp).toEqual(expect.any(String));
  }
});

test('console capture can be disabled without disabling evalLog', async () => {
  configureEvalRunLogs({ captureConsole: false });

  try {
    const result = await runCase({
      evalDef: {
        id: 'console-disabled-eval',
        cases: [{ id: 'case-one', input: {} }],
        execute: () => {
          console.error('not persisted');
          evalLog('log', 'persisted manual log');
        },
      },
      evalId: 'console-disabled-eval',
      evalCase: { id: 'case-one', input: {} },
      globalTraceDisplay: undefined,
      trial: 0,
      startTime: Date.now(),
      cacheAdapter: null,
      cacheMode: 'use',
      codeFingerprint: 'fingerprint',
      moduleIsolation: undefined,
      evalFilePath: '/repo/evals/support/console-disabled.eval.ts',
      workspaceRoot: '/repo',
      artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
      runId: 'run-id',
    });

    expect(result.caseDetail.logs.map((entry) => entry.message)).toEqual([
      'persisted manual log',
    ]);
  } finally {
    configureEvalRunLogs({ captureConsole: true });
  }
});

test('individual log messages are truncated before persistence', async () => {
  const longMessage = 'x'.repeat(25_000);

  const result = await runCase({
    evalDef: {
      id: 'log-truncation-eval',
      cases: [{ id: 'case-one', input: {} }],
      execute: () => {
        evalLog('log', longMessage);
      },
    },
    evalId: 'log-truncation-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/log-truncation.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  const [entry] = result.caseDetail.logs;
  expect(entry?.truncated).toBe(true);
  expect(entry?.message).toHaveLength(20_003);
  expect(entry?.message.endsWith('...')).toBe(true);
  expect(entry?.args).toEqual([`${'x'.repeat(10_000)}...`]);
});

test('cached spans replay outputs but do not replay logs', async () => {
  const cacheEntries = new Map<string, CacheEntry>();
  const cacheAdapter: CacheAdapter = {
    lookup(namespace, keyHash) {
      return Promise.resolve(
        cacheEntries.get(`${namespace}:${keyHash}`) ?? null,
      );
    },
    write(entry) {
      cacheEntries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  };

  const evalDef = {
    id: 'cached-log-eval',
    cases: [{ id: 'case-one', input: {} }],
    execute: async () => {
      await evalTracer.span(
        {
          kind: 'tool',
          name: 'cached-tool',
          cache: { key: { caseId: 'case-one' } },
        },
        () => {
          evalLog('info', 'inside cached operation');
          setEvalOutput('value', 'from cached operation');
          return 'done';
        },
      );
    },
  };

  const first = await runCase({
    evalDef,
    evalId: 'cached-log-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/cached-log.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  const second = await runCase({
    evalDef,
    evalId: 'cached-log-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/support/cached-log.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });

  expect(first.caseDetail.columns.value).toBe('from cached operation');
  expect(first.caseDetail.logs.map((entry) => entry.message)).toEqual([
    'inside cached operation',
  ]);
  expect(second.caseDetail.columns.value).toBe('from cached operation');
  expect(second.caseDetail.logs).toEqual([]);
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
