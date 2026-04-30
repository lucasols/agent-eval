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

test('uses frozen eval startTime while generating cases in the run child', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-start-time-'),
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
    join(workspacePath, 'evals', 'start-time.eval.ts'),
    `import { defineEval, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'start-time-eval',
  title: 'Start Time Eval',
  startTime: '2024-01-02T03:04:05.000Z',
  freezeTime: true,
  cases: () => [
    { id: new Date().toISOString(), input: { generatedAt: Date.now() } },
  ],
  execute: ({ input }) => {
    setEvalOutput('generatedAt', input.generatedAt);
    setEvalOutput('executedAt', new Date().toISOString());
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
      target: { mode: 'evalIds', evalIds: ['start-time-eval'] },
      trials: 1,
    });

    await expect
      .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const detail = runner.getCaseDetail(
      startedRun.manifest.id,
      '2024-01-02T03:04:05.000Z',
    );
    expect(detail?.columns).toMatchObject({
      generatedAt: 1704164645000,
      executedAt: '2024-01-02T03:04:05.000Z',
    });
  } finally {
    process.chdir(previousCwd);
  }
});
