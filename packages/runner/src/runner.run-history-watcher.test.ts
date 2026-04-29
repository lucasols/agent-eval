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

describe('runner run history watcher', () => {
  test('loads externally persisted CLI runs while watching', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-watch-runs-'),
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
      join(workspacePath, 'evals', 'external-run.eval.ts'),
      `import { defineEval, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'external-run-eval',
  title: 'External Run Eval',
  cases: [{ id: 'external-case', input: { value: 'ok' } }],
  execute: async () => {
    setEvalOutput('result', 'observed');
  },
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const watchedRunner = createRunner({ watchForChanges: true });
    const cliRunner = createRunner({ watchForChanges: false });

    try {
      await watchedRunner.init();
      await cliRunner.init();

      const cliRun = await cliRunner.startRun({
        target: { mode: 'evalIds', evalIds: ['external-run-eval'] },
        trials: 1,
      });

      await expect
        .poll(() => cliRunner.getRun(cliRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      await expect
        .poll(() => watchedRunner.getRun(cliRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      expect(watchedRunner.getRuns()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: cliRun.manifest.id }),
        ]),
      );
      expect(watchedRunner.getRun(cliRun.manifest.id)?.cases).toEqual([
        expect.objectContaining({
          caseId: 'external-case',
          evalId: 'external-run-eval',
          status: 'pass',
        }),
      ]);
      expect(watchedRunner.getEval('external-run-eval')?.lastRunStatus).toBe(
        'pass',
      );
    } finally {
      await cliRunner.close();
      await watchedRunner.close();
      process.chdir(previousCwd);
    }
  }, 15_000);
});
