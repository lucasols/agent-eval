import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createRunner } from './runner.ts';

const createdWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdWorkspaces.map(async (workspacePath) => {
      await rm(workspacePath, { recursive: true, force: true });
    }),
  );
  createdWorkspaces.length = 0;
});

test('records externally managed span lifecycle events in the eval trace', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-external-tracing-'),
  );
  createdWorkspaces.push(workspacePath);

  await mkdir(join(workspacePath, 'evals'), { recursive: true });
  await writeFile(
    join(workspacePath, 'agent-evals.config.ts'),
    `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
  );
  await writeFile(
    join(workspacePath, 'evals', 'external-tracing.eval.ts'),
    `import { defineEval, evalTracer, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'external-tracing-eval',
  title: 'External Tracing Eval',
  cases: [
    { id: 'trace-me', input: { prompt: 'Check refund policy' } },
  ],
  execute: async ({ input }) => {
    const agentSpan = evalTracer.startSpan({
      id: 'mastra-agent-run',
      parentId: null,
      kind: 'agent',
      name: 'support-agent',
      startedAt: '2026-04-21T11:59:59.900Z',
      attributes: { input },
    });

    const modelSpan = evalTracer.startSpan({
      id: 'mastra-model-generation',
      parentId: agentSpan.id,
      kind: 'llm',
      name: 'model-generation',
      startedAt: '2026-04-21T12:00:00.000Z',
      attributes: { input: input.prompt },
    });

    modelSpan.setAttribute('model', 'gpt-4o-mini');
    evalTracer.updateSpan({
      id: modelSpan.id,
      name: 'refund-policy-generation',
      attributes: { usage: { inputTokens: 42 } },
    });

    evalTracer.recordSpan({
      id: 'mastra-workflow-step',
      parentId: agentSpan.id,
      kind: 'mastra.workflow.step',
      name: 'prepare-refund-context',
      startedAt: '2026-04-21T12:00:00.020Z',
      endedAt: '2026-04-21T12:00:00.040Z',
      attributes: { input: input.prompt },
    });

    evalTracer.recordSpan({
      id: 'mastra-tool-call',
      parentId: modelSpan.id,
      kind: 'tool',
      name: 'lookup-refund-policy',
      startedAt: '2026-04-21T12:00:00.050Z',
      endedAt: '2026-04-21T12:00:00.070Z',
      attributes: { output: { eligible: true } },
    });

    modelSpan.end({
      endedAt: '2026-04-21T12:00:00.100Z',
      attributes: { output: 'Refund is eligible.' },
    });

    agentSpan.end({
      endedAt: '2026-04-21T12:00:00.120Z',
      attributes: { output: 'Refund is eligible.' },
    });

    setEvalOutput('response', 'Refund is eligible.');
  },
  deriveFromTracing: ({ trace }) => ({
    llmSpans: trace.findSpansByKind('llm').length,
    workflowSteps: trace.findSpansByKind('mastra.workflow.step').length,
    toolSpans: trace.findSpansByKind('tool').length,
  }),
});
`,
  );

  const previousCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    const run = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['external-tracing-eval'] },
      trials: 1,
      cache: { mode: 'use' },
    });

    await expect
      .poll(() => runner.getRun(run.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const detail = runner.getCaseDetail(run.manifest.id, 'trace-me');
    expect(detail?.columns).toMatchObject({
      response: 'Refund is eligible.',
      llmSpans: 1,
      workflowSteps: 1,
      toolSpans: 1,
    });

    const modelSpan = detail?.trace.find(
      (span) => span.id === 'mastra-model-generation',
    );
    expect(modelSpan).toMatchObject({
      parentId: 'mastra-agent-run',
      kind: 'llm',
      name: 'refund-policy-generation',
      startedAt: '2026-04-21T12:00:00.000Z',
      endedAt: '2026-04-21T12:00:00.100Z',
      status: 'ok',
      attributes: {
        input: 'Check refund policy',
        model: 'gpt-4o-mini',
        usage: { inputTokens: 42 },
        output: 'Refund is eligible.',
      },
    });

    expect(
      detail?.trace.find((span) => span.id === 'mastra-workflow-step'),
    ).toMatchObject({
      parentId: 'mastra-agent-run',
      kind: 'mastra.workflow.step',
      name: 'prepare-refund-context',
      status: 'ok',
      attributes: { input: 'Check refund policy' },
    });

    expect(
      detail?.trace.find((span) => span.id === 'mastra-tool-call'),
    ).toMatchObject({
      parentId: 'mastra-model-generation',
      kind: 'tool',
      name: 'lookup-refund-policy',
      status: 'ok',
      attributes: { output: { eligible: true } },
    });
  } finally {
    process.chdir(previousCwd);
  }
});

test('captures recoverable errors on the active span and replays them from cache', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-captured-span-errors-'),
  );
  createdWorkspaces.push(workspacePath);

  await mkdir(join(workspacePath, 'evals'), { recursive: true });
  await writeFile(
    join(workspacePath, 'agent-evals.config.ts'),
    `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
  );
  await writeFile(
    join(workspacePath, 'evals', 'captured-span-errors.eval.ts'),
    `import {
  captureEvalSpanError,
  defineEval,
  evalSpan,
  evalTracer,
  setEvalOutput,
} from '@agent-evals/sdk';

defineEval({
  id: 'captured-span-errors-eval',
  title: 'Captured Span Errors Eval',
  cases: [{ id: 'recoverable-case', input: { request: 'refund' } }],
  execute: async ({ input }) => {
    await evalTracer.span(
      {
        kind: 'tool',
        name: 'optional-signal-loader',
        cache: { key: input },
      },
      async () => {
        const primaryError = new Error('Primary signal source timed out');
        Object.assign(primaryError, {
          category: 'timeout',
          details: { source: 'primary' },
          domain: 'signals',
        });

        captureEvalSpanError(
          primaryError,
          {
            category: 'payload',
            details: { source: 'secondary' },
            domain: 'signals',
            message: 'Secondary signal payload was malformed',
            name: 'TypeError',
          },
        );
        captureEvalSpanError([new Error('Tertiary signal was unavailable')]);
        evalSpan.setAttribute('fallback', 'rules-engine');
        setEvalOutput('result', 'used fallback');
      },
    );
  },
});
`,
  );

  const previousCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    const firstRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['captured-span-errors-eval'] },
      trials: 1,
      cache: { mode: 'use' },
    });

    await expect
      .poll(() => runner.getRun(firstRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const firstDetail = runner.getCaseDetail(
      firstRun.manifest.id,
      'recoverable-case',
    );
    expect(firstDetail?.status).toBe('pass');
    const firstSpan = firstDetail?.trace.find(
      (span) => span.name === 'optional-signal-loader',
    );
    expect(firstSpan).toMatchObject({
      status: 'error',
      attributes: { fallback: 'rules-engine', 'cache.status': 'miss' },
      error: { name: 'Error', message: 'Tertiary signal was unavailable' },
      errors: [
        {
          category: 'timeout',
          details: { source: 'primary' },
          domain: 'signals',
          name: 'Error',
          message: 'Primary signal source timed out',
        },
        {
          category: 'payload',
          details: { source: 'secondary' },
          domain: 'signals',
          name: 'TypeError',
          message: 'Secondary signal payload was malformed',
        },
        { name: 'Error', message: 'Tertiary signal was unavailable' },
      ],
    });
    const firstCapturedAt = firstSpan?.errors?.map((error) => error.capturedAt);
    expect(firstCapturedAt).toHaveLength(3);
    expect(
      firstCapturedAt?.every(
        (capturedAt) =>
          typeof capturedAt === 'string' &&
          !Number.isNaN(Date.parse(capturedAt)),
      ),
    ).toBe(true);

    const secondRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['captured-span-errors-eval'] },
      trials: 1,
      cache: { mode: 'use' },
    });

    await expect
      .poll(() => runner.getRun(secondRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const secondDetail = runner.getCaseDetail(
      secondRun.manifest.id,
      'recoverable-case',
    );
    const secondSpan = secondDetail?.trace.find(
      (span) => span.name === 'optional-signal-loader',
    );
    expect(secondSpan).toMatchObject({
      status: 'error',
      attributes: { fallback: 'rules-engine', 'cache.status': 'hit' },
      error: { name: 'Error', message: 'Tertiary signal was unavailable' },
      errors: [
        {
          category: 'timeout',
          details: { source: 'primary' },
          domain: 'signals',
          name: 'Error',
          message: 'Primary signal source timed out',
        },
        {
          category: 'payload',
          details: { source: 'secondary' },
          domain: 'signals',
          name: 'TypeError',
          message: 'Secondary signal payload was malformed',
        },
        { name: 'Error', message: 'Tertiary signal was unavailable' },
      ],
    });
    expect(secondSpan?.errors?.map((error) => error.capturedAt)).toEqual(
      firstCapturedAt,
    );
  } finally {
    process.chdir(previousCwd);
  }
});
