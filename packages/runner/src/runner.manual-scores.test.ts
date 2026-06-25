import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineEval, runWithEvalRegistry } from '@agent-evals/sdk';
import { afterEach, describe, expect, test, vi } from 'vitest';
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

describe('runner manual scores', () => {
  test('manual score descriptions are required', async () => {
    await expect(
      runWithEvalRegistry(() =>
        defineEval({
          id: 'missing-manual-score-description',
          cases: [],
          execute: () => {},
          manualScores: { review: { label: 'Review', description: '   ' } },
        }),
      ),
    ).rejects.toThrow(
      'Manual score "review" in eval "missing-manual-score-description" must declare a non-empty description',
    );
  });

  test('manual scores start unscored and update persisted case results', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-manual-score-'),
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
      join(workspacePath, 'evals', 'manual-score.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'manual-score-eval',
  title: 'Manual Score Eval',
  cases: [{ id: 'review-me', input: {} }],
  execute: async () => {},
  manualScores: {
    reviewerDecision: {
      label: 'Reviewer Decision',
      description: 'Confirm the case is acceptable for release.',
      format: 'passFail',
      passThreshold: 0.5,
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

      expect(runner.getEval('manual-score-eval')?.lastRunStatus).toBe(
        'unscored',
      );
      expect(runner.getEval('manual-score-eval')?.columnDefs).toEqual(
        expect.arrayContaining([
          {
            key: 'reviewerDecision',
            label: 'Reviewer Decision',
            description: 'Confirm the case is acceptable for release.',
            kind: 'number',
            format: 'passFail',
            isScore: true,
            isManualScore: true,
            passThreshold: 0.5,
          },
        ]),
      );
      expect(runner.getRun(startedRun.manifest.id)?.cases).toMatchObject([
        {
          caseId: 'review-me',
          evalId: 'manual-score-eval',
          status: 'pass',
          columns: { reviewerDecision: null },
        },
      ]);

      const failed = await runner.updateManualScore({
        runId: startedRun.manifest.id,
        caseId: 'review-me',
        scoreKey: 'reviewerDecision',
        value: 0,
      });

      expect(failed.updated).toBe(true);
      expect(runner.getEval('manual-score-eval')?.lastRunStatus).toBe('fail');
      expect(runner.getRun(startedRun.manifest.id)?.cases).toMatchObject([
        {
          caseId: 'review-me',
          status: 'fail',
          columns: { reviewerDecision: 0 },
        },
      ]);

      const passed = await runner.updateManualScore({
        runId: startedRun.manifest.id,
        caseId: 'review-me',
        scoreKey: 'reviewerDecision',
        value: 1,
      });

      expect(passed.updated).toBe(true);
      expect(runner.getEval('manual-score-eval')?.lastRunStatus).toBe('pass');
      expect(
        runner.getCaseDetail(startedRun.manifest.id, 'review-me')?.columns,
      ).toMatchObject({ reviewerDecision: 1 });
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('pending score columns from older runs can be filled manually', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-manual-score-fallback-'),
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
    const evalFilePath = join(workspacePath, 'evals', 'manual-score.eval.ts');
    await writeFile(
      evalFilePath,
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'manual-score-fallback-eval',
  cases: [{ id: 'review-me', input: {} }],
  execute: async () => {},
  manualScores: {
    reviewerDecision: {
      label: 'Reviewer Decision',
      description: 'Confirm the case is acceptable for release.',
      format: 'passFail',
      passThreshold: 0.5,
    },
  },
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const firstRunner = createRunner({ watchForChanges: false });
      await firstRunner.init();

      const startedRun = await firstRunner.startRun({
        target: { mode: 'all' },
        trials: 1,
      });

      await expect
        .poll(() => firstRunner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      await writeFile(
        evalFilePath,
        `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'manual-score-fallback-eval',
  cases: [{ id: 'review-me', input: {} }],
  execute: async () => {},
  scores: {
    reviewerDecision: {
      label: 'Reviewer Decision',
      compute: () => 1,
      format: 'passFail',
      passThreshold: 0.5,
    },
  },
});
`,
      );
      vi.resetModules();

      const secondRunner = createRunner({ watchForChanges: false });
      await secondRunner.init();
      expect(
        secondRunner
          .getEval('manual-score-fallback-eval')
          ?.columnDefs.find((def) => def.key === 'reviewerDecision'),
      ).toBeUndefined();

      const updated = await secondRunner.updateManualScore({
        runId: startedRun.manifest.id,
        caseId: 'review-me',
        scoreKey: 'reviewerDecision',
        value: 1,
      });

      expect(updated.updated).toBe(true);
      expect(
        secondRunner.getCaseDetail(startedRun.manifest.id, 'review-me')
          ?.columns,
      ).toMatchObject({ reviewerDecision: 1 });

      const changedAfterFill = await secondRunner.updateManualScore({
        runId: startedRun.manifest.id,
        caseId: 'review-me',
        scoreKey: 'reviewerDecision',
        value: 0,
      });

      expect(changedAfterFill).toEqual({
        updated: false,
        reason: 'Manual score not found',
      });
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);
});
