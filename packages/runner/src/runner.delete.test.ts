import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

describe('runner.deleteRun', () => {
  test('deletes a persisted terminal run from memory and disk', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-delete-run-'),
    );
    createdWorkspaces.push(workspacePath);

    const runId = '2026-04-21T12-30-00Z_delete';
    const runDir = join(workspacePath, '.agent-evals', 'runs', runId);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await mkdir(join(runDir, 'case-details'), { recursive: true });

    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'delete.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({ id: 'delete-eval', title: 'Delete Eval' });
`,
    );
    await writeFile(
      join(runDir, 'run.json'),
      JSON.stringify(
        {
          id: runId,
          shortId: 'r0',
          status: 'completed',
          startedAt: '2026-04-21T12:30:00.000Z',
          endedAt: '2026-04-21T12:30:01.000Z',
          target: { mode: 'evalIds', evalIds: ['delete-eval'] },
          trials: 1,
          cacheMode: 'use',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(runDir, 'summary.json'),
      JSON.stringify(
        {
          runId,
          status: 'completed',
          totalCases: 0,
          passedCases: 0,
          failedCases: 0,
          errorCases: 0,
          cancelledCases: 0,
          totalDurationMs: 1000,
          cost: { totalUsd: null },
          errorMessage: null,
        },
        null,
        2,
      ),
    );
    await writeFile(join(runDir, 'cases.jsonl'), '');

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getRun(runId)).toBeDefined();

      const deleted = await runner.deleteRun(runId);
      expect(deleted).toEqual({ deleted: true });
      expect(runner.getRun(runId)).toBeUndefined();
      expect(runner.getRuns()).toHaveLength(0);

      const missing = await runner.deleteRun(runId);
      expect(missing).toEqual({ deleted: false });

      await expect(
        readFile(join(runDir, 'run.json'), 'utf-8'),
      ).rejects.toThrow();
    } finally {
      process.chdir(previousCwd);
    }
  });
});
