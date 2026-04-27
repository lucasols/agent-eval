import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
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

describe('runner output schemas', () => {
  test('validates configured output fields without dropping unconfigured outputs', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-output-schema-'),
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
      join(workspacePath, 'evals', 'output-schema.eval.ts'),
      `import { defineEval, setEvalOutput, z } from '@agent-evals/sdk';

const outputsSchema = z.object({
  response: z.string(),
  confidence: z.number().default(0.75),
}).strict();

defineEval({
  id: 'output-schema-eval',
  title: 'Output Schema Eval',
  cases: [
    { id: 'valid-output', input: { response: 'refund approved', latencyMs: 123 } },
    { id: 'invalid-output', input: { response: 42, latencyMs: 456 } },
  ],
  outputsSchema,
  execute: ({ input }) => {
    setEvalOutput('response', input.response);
    setEvalOutput('latencyMs', input.latencyMs);
  },
  scores: {
    mentionsRefund: {
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.response.includes('refund') ? 1 : 0),
    },
  },
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const startedRun = await runner.startRun({
        target: { mode: 'all' },
        trials: 1,
      });

      await expect
        .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      const run = runner.getRun(startedRun.manifest.id);
      expect(run?.summary).toMatchObject({
        passedCases: 1,
        failedCases: 1,
        errorCases: 0,
      });
      expect(run?.cases).toMatchObject([
        {
          caseId: 'valid-output',
          status: 'pass',
          columns: {
            response: 'refund approved',
            latencyMs: 123,
            confidence: 0.75,
            mentionsRefund: 1,
          },
        },
        {
          caseId: 'invalid-output',
          status: 'fail',
          columns: { response: 42, latencyMs: 456 },
        },
      ]);

      const invalidDetail = runner.getCaseDetail(
        startedRun.manifest.id,
        'invalid-output',
      );
      expect(invalidDetail?.assertionFailures[0]?.message).toContain(
        'outputsSchema validation failed',
      );
      expect(invalidDetail?.assertionFailures[0]?.message).toContain(
        'response: Invalid input: expected string, received number',
      );
      expect(invalidDetail?.columns.mentionsRefund).toBeUndefined();
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);
});
