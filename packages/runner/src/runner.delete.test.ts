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

async function createTemporaryRunWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-temporary-runs-'),
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
    join(workspacePath, 'evals', 'temporary.eval.ts'),
    `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'fast-run',
  cases: [{ id: 'fast-case', input: null }],
  execute: () => {},
});

defineEval({
  id: 'slow-temp',
  cases: [{ id: 'slow-case', input: null }],
  execute: async () => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  },
});
`,
  );

  return workspacePath;
}

async function withWorkspace<T>(
  workspacePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(workspacePath);
  try {
    return await fn();
  } finally {
    process.chdir(previousCwd);
  }
}

async function waitForRunStatus(
  runner: ReturnType<typeof createRunner>,
  runId: string,
  status: 'completed' | 'cancelled' | 'error',
): Promise<void> {
  await expect
    .poll(() => runner.getRun(runId)?.manifest.status, { timeout: 10_000 })
    .toBe(status);
}

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
          temporary: false,
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

  test('replaces a previous temporary run when another temp run starts', async () => {
    const workspacePath = await createTemporaryRunWorkspace();

    await withWorkspace(workspacePath, async () => {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const firstRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
        temporary: true,
      });
      await waitForRunStatus(runner, firstRun.manifest.id, 'completed');

      const secondRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
        temporary: true,
      });
      await waitForRunStatus(runner, secondRun.manifest.id, 'completed');

      expect(runner.getRun(firstRun.manifest.id)).toBeUndefined();
      expect(runner.getRun(secondRun.manifest.id)?.manifest.temporary).toBe(
        true,
      );
      expect(runner.getRuns().map((run) => run.id)).toEqual([
        secondRun.manifest.id,
      ]);
      await expect(
        readFile(
          join(workspacePath, '.agent-evals', 'runs', firstRun.manifest.id),
          'utf-8',
        ),
      ).rejects.toThrow();
      await runner.close();
    });
  });

  test('deletes previous temporary runs before starting a normal run', async () => {
    const workspacePath = await createTemporaryRunWorkspace();

    await withWorkspace(workspacePath, async () => {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const temporaryRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
        temporary: true,
      });
      await waitForRunStatus(runner, temporaryRun.manifest.id, 'completed');

      const normalRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
      });
      await waitForRunStatus(runner, normalRun.manifest.id, 'completed');

      expect(runner.getRun(temporaryRun.manifest.id)).toBeUndefined();
      expect(runner.getRun(normalRun.manifest.id)?.manifest.temporary).toBe(
        false,
      );
      expect(runner.getRuns().map((run) => run.id)).toEqual([
        normalRun.manifest.id,
      ]);
      await runner.close();
    });
  });

  test('keeps normal runs when temporary runs are replaced', async () => {
    const workspacePath = await createTemporaryRunWorkspace();

    await withWorkspace(workspacePath, async () => {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const normalRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
      });
      await waitForRunStatus(runner, normalRun.manifest.id, 'completed');

      const firstTemporaryRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
        temporary: true,
      });
      await waitForRunStatus(
        runner,
        firstTemporaryRun.manifest.id,
        'completed',
      );

      const secondTemporaryRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
        temporary: true,
      });
      await waitForRunStatus(
        runner,
        secondTemporaryRun.manifest.id,
        'completed',
      );

      expect(runner.getRun(normalRun.manifest.id)).toBeDefined();
      expect(runner.getRun(firstTemporaryRun.manifest.id)).toBeUndefined();
      expect(runner.getRun(secondTemporaryRun.manifest.id)).toBeDefined();
      expect(runner.getRuns().map((run) => run.id)).toEqual([
        normalRun.manifest.id,
        secondTemporaryRun.manifest.id,
      ]);
      await runner.close();
    });
  });

  test('deletes persisted temporary runs loaded during init', async () => {
    const workspacePath = await createTemporaryRunWorkspace();

    await withWorkspace(workspacePath, async () => {
      const firstRunner = createRunner({ watchForChanges: false });
      await firstRunner.init();
      const temporaryRun = await firstRunner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
        temporary: true,
      });
      await waitForRunStatus(
        firstRunner,
        temporaryRun.manifest.id,
        'completed',
      );
      await firstRunner.close();

      const secondRunner = createRunner({ watchForChanges: false });
      await secondRunner.init();
      expect(secondRunner.getRun(temporaryRun.manifest.id)).toBeDefined();

      const normalRun = await secondRunner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
      });
      await waitForRunStatus(secondRunner, normalRun.manifest.id, 'completed');

      expect(secondRunner.getRun(temporaryRun.manifest.id)).toBeUndefined();
      expect(secondRunner.getRun(normalRun.manifest.id)).toBeDefined();
      await secondRunner.close();
    });
  });

  test('cancels and deletes a running temporary run before any new run starts', async () => {
    const workspacePath = await createTemporaryRunWorkspace();

    await withWorkspace(workspacePath, async () => {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const slowTemporaryRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['slow-temp'] },
        trials: 1,
        temporary: true,
      });
      expect(runner.getRun(slowTemporaryRun.manifest.id)?.manifest.status).toBe(
        'running',
      );

      const normalRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['fast-run'] },
        trials: 1,
      });
      await waitForRunStatus(runner, normalRun.manifest.id, 'completed');

      expect(runner.getRun(slowTemporaryRun.manifest.id)).toBeUndefined();
      expect(runner.getRun(normalRun.manifest.id)).toBeDefined();
      await runner.close();
    });
  });
});
