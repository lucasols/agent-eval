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

async function createWorkspace(evalSource: string): Promise<string> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-score-override-'),
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
    join(workspacePath, 'evals', 'score-override.eval.ts'),
    evalSource,
  );
  return workspacePath;
}

async function withRunner(
  workspacePath: string,
  fn: (runner: ReturnType<typeof createRunner>, runId: string) => Promise<void>,
): Promise<void> {
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
    await fn(runner, startedRun.manifest.id);
  } finally {
    process.chdir(previousCwd);
  }
}

describe('runner score overrides', () => {
  test('overrides a computed score, keeps the original value, and reverts', async () => {
    const workspacePath =
      await createWorkspace(`import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'score-override-eval',
  cases: [{ id: 'judge-wrong', input: {} }],
  execute: async () => {},
  scores: {
    judge: { label: 'Judge', compute: () => 0.2, passThreshold: 0.5 },
  },
  manualScores: {
    review: {
      label: 'Review',
      description: 'Confirm the answer is acceptable.',
      format: 'passFail',
    },
  },
});
`);

    await withRunner(workspacePath, async (runner, runId) => {
      expect(runner.getRun(runId)?.cases).toMatchObject([
        { caseId: 'judge-wrong', status: 'fail', columns: { judge: 0.2 } },
      ]);

      const overridden = await runner.setScoreOverride({
        runId,
        caseId: 'judge-wrong',
        scoreKey: 'judge',
        value: 0.9,
        reason: '  Judge misread the answer  ',
      });
      expect(overridden.updated).toBe(true);

      const overriddenRow = runner.getRun(runId)?.cases[0];
      expect(overriddenRow).toMatchObject({
        status: 'pass',
        columns: { judge: 0.9 },
        scoreOverrides: {
          judge: { originalValue: 0.2, reason: 'Judge misread the answer' },
        },
      });
      expect(runner.getRun(runId)?.summary).toMatchObject({
        passedCases: 1,
        failedCases: 0,
      });
      expect(
        runner.getCaseDetail(runId, 'judge-wrong')?.scoreOverrides,
      ).toEqual(overriddenRow?.scoreOverrides);

      const persistedCases = await readFile(
        join(workspacePath, '.agent-evals', 'runs', runId, 'cases.jsonl'),
        'utf8',
      );
      expect(persistedCases).toContain(
        '"scoreOverrides":{"judge":{"originalValue":0.2,"reason":"Judge misread the answer"',
      );

      const reOverridden = await runner.setScoreOverride({
        runId,
        caseId: 'judge-wrong',
        scoreKey: 'judge',
        value: 0.4,
        reason: undefined,
      });
      expect(reOverridden.updated).toBe(true);
      expect(runner.getRun(runId)?.cases[0]).toMatchObject({
        status: 'fail',
        columns: { judge: 0.4 },
      });
      const reOverride = runner.getRun(runId)?.cases[0]?.scoreOverrides?.judge;
      expect(reOverride?.originalValue).toBe(0.2);
      expect(reOverride?.reason).toBeUndefined();

      const reverted = await runner.setScoreOverride({
        runId,
        caseId: 'judge-wrong',
        scoreKey: 'judge',
        value: null,
        reason: undefined,
      });
      expect(reverted.updated).toBe(true);
      const revertedRow = runner.getRun(runId)?.cases[0];
      expect(revertedRow).toMatchObject({
        status: 'fail',
        columns: { judge: 0.2 },
      });
      expect(revertedRow?.scoreOverrides).toBeUndefined();

      expect(
        await runner.setScoreOverride({
          runId,
          caseId: 'judge-wrong',
          scoreKey: 'judge',
          value: null,
          reason: undefined,
        }),
      ).toEqual({ updated: false, reason: 'Score override not found' });

      expect(
        await runner.setScoreOverride({
          runId,
          caseId: 'judge-wrong',
          scoreKey: 'review',
          value: 1,
          reason: undefined,
        }),
      ).toEqual({ updated: false, reason: 'Computed score not found' });
    });
  }, 15_000);

  test('overriding a score whose scorer threw stops the failure from gating', async () => {
    const workspacePath =
      await createWorkspace(`import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'score-override-throw-eval',
  cases: [{ id: 'judge-crashed', input: {} }],
  execute: async () => {},
  scores: {
    judge: {
      label: 'Judge',
      passThreshold: 0.5,
      compute: () => {
        throw new Error('judge response was not valid JSON');
      },
    },
  },
});
`);

    await withRunner(workspacePath, async (runner, runId) => {
      expect(runner.getRun(runId)?.cases).toMatchObject([
        { status: 'fail', columns: { judge: 0 } },
      ]);

      await runner.setScoreOverride({
        runId,
        caseId: 'judge-crashed',
        scoreKey: 'judge',
        value: 1,
        reason: 'Judged manually',
      });
      expect(runner.getRun(runId)?.cases).toMatchObject([
        {
          status: 'pass',
          columns: { judge: 1 },
          scoreOverrides: { judge: { originalValue: 0 } },
        },
      ]);
      expect(runner.getEval('score-override-throw-eval')?.lastRunStatus).toBe(
        'pass',
      );

      await runner.setScoreOverride({
        runId,
        caseId: 'judge-crashed',
        scoreKey: 'judge',
        value: null,
        reason: undefined,
      });
      expect(runner.getRun(runId)?.cases).toMatchObject([
        { status: 'fail', columns: { judge: 0 } },
      ]);
    });
  }, 15_000);
});
