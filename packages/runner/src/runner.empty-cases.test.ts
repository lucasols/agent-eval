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

test('runs evals without authored cases once with an empty input object', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-empty-cases-'),
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
    join(workspacePath, 'evals', 'empty-cases.eval.ts'),
    `import { defineEval, setOutput } from '@agent-evals/sdk';

defineEval({
  id: 'empty-cases-eval',
  title: 'Empty Cases Eval',
  execute: ({ input }) => {
    setOutput('observedInput', JSON.stringify(input));
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
      target: { mode: 'evalIds', evalIds: ['empty-cases-eval'] },
      trials: 1,
    });

    await expect
      .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const run = runner.getRun(startedRun.manifest.id);
    expect(run?.summary).toMatchObject({
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      errorCases: 0,
    });
    expect(run?.cases).toMatchObject([
      {
        caseId: 'empty-cases-eval-no-output',
        evalId: 'empty-cases-eval',
        status: 'pass',
        columns: { observedInput: '{}' },
        trial: 0,
      },
    ]);
    expect(
      runner.getCaseDetail(
        startedRun.manifest.id,
        'empty-cases-eval-no-output',
      ),
    ).toMatchObject({
      caseId: 'empty-cases-eval-no-output',
      evalId: 'empty-cases-eval',
      input: {},
      status: 'pass',
      columns: { observedInput: '{}' },
      trial: 0,
    });
  } finally {
    process.chdir(previousCwd);
  }
}, 10_000);
