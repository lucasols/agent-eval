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

describe('createRunner', () => {
  test('emits discovery updates after refreshing changed eval files', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-watch-'),
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
    const evalPath = join(workspacePath, 'evals', 'editable.eval.ts');
    await writeFile(
      evalPath,
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'editable-eval',
  title: 'Original Title',
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getEval('editable-eval')?.title).toBe('Original Title');

      const discoveryUpdated = new Promise<void>((resolve) => {
        const unsubscribe = runner.subscribeDiscovery((event) => {
          if (event.type !== 'discovery.updated') return;
          unsubscribe();
          resolve();
        });
      });

      await writeFile(
        evalPath,
        `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'editable-eval',
  title: 'Updated Title',
});
        `,
      );

      await runner.refreshDiscovery();
      await discoveryUpdated;

      await expect
        .poll(() => runner.getEval('editable-eval')?.title)
        .toBe('Updated Title');
      expect(runner.getEval('editable-eval')?.stale).toBe(false);
      const persistedFile = await readFile(evalPath, 'utf-8');
      expect(persistedFile).toContain('Updated Title');
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('loads persisted runs and case details during init', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-persisted-runs-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await mkdir(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_abc123',
      ),
      { recursive: true },
    );
    await mkdir(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_abc123',
        'case-details',
      ),
      { recursive: true },
    );

    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'persisted.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'persisted-eval',
  title: 'Persisted Eval',
});
`,
    );

    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_abc123',
        'run.json',
      ),
      JSON.stringify(
        {
          id: '2026-04-21T12-00-00Z_abc123',
          shortId: 'r0',
          status: 'completed',
          startedAt: '2026-04-21T12:00:00.000Z',
          endedAt: '2026-04-21T12:00:02.000Z',
          target: { mode: 'evalIds', evalIds: ['persisted-eval'] },
          trials: 1,
          cacheMode: 'use',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_abc123',
        'summary.json',
      ),
      JSON.stringify(
        {
          runId: '2026-04-21T12-00-00Z_abc123',
          status: 'completed',
          totalCases: 1,
          passedCases: 1,
          failedCases: 0,
          errorCases: 0,
          cancelledCases: 0,
          averageScore: 1,
          totalDurationMs: 2000,
          cost: { totalUsd: 0.12 },
          errorMessage: null,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_abc123',
        'cases.jsonl',
      ),
      `${JSON.stringify({
        caseId: 'saved-case',
        evalId: 'persisted-eval',
        status: 'pass',
        score: 1,
        latencyMs: 234,
        costUsd: 0.12,
        columns: { answer: 'ok' },
        trial: 0,
      })}
`,
    );
    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_abc123',
        'case-details',
        'saved-case.json',
      ),
      JSON.stringify(
        {
          caseId: 'saved-case',
          evalId: 'persisted-eval',
          status: 'pass',
          input: { prompt: 'hi' },
          trace: [],
          traceDisplay: { attributes: [] },
          cost: { totalUsd: 0.12 },
          columns: { answer: 'ok' },
          assertionFailures: [],
          error: null,
          trial: 0,
        },
        null,
        2,
      ),
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getRuns()).toHaveLength(1);
      expect(runner.getRun('2026-04-21T12-00-00Z_abc123')).toMatchObject({
        manifest: { id: '2026-04-21T12-00-00Z_abc123', status: 'completed' },
        summary: { totalCases: 1, passedCases: 1 },
        cases: [
          { caseId: 'saved-case', evalId: 'persisted-eval', status: 'pass' },
        ],
      });
      expect(
        runner.getCaseDetail('2026-04-21T12-00-00Z_abc123', 'saved-case'),
      ).toMatchObject({
        caseId: 'saved-case',
        evalId: 'persisted-eval',
        status: 'pass',
        columns: { answer: 'ok' },
      });
      expect(runner.getEval('persisted-eval')?.lastRunStatus).toBe('pass');
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('derives each eval lastRunStatus from only that eval cases within a run', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-status-scope-'),
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
      join(workspacePath, 'evals', 'scoped-status.eval.ts'),
      `import { defineEval, evalAssert } from '@agent-evals/sdk';

defineEval({
  id: 'failing-eval',
  title: 'Failing Eval',
  cases: [{ id: 'fail-case', input: {} }],
  execute: async () => {
    evalAssert(false, 'expected failure');
  },
});

defineEval({
  id: 'passing-eval',
  title: 'Passing Eval',
  cases: [{ id: 'pass-case', input: {} }],
  execute: async () => {},
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

      expect(runner.getEval('failing-eval')?.lastRunStatus).toBe('fail');
      expect(runner.getEval('passing-eval')?.lastRunStatus).toBe('pass');
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('uses the latest scoped run result when loading eval statuses', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-latest-status-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await mkdir(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_old123',
        'case-details',
      ),
      { recursive: true },
    );
    await mkdir(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-05-00Z_new456',
        'case-details',
      ),
      { recursive: true },
    );

    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'persisted.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({ id: 'persisted-eval', title: 'Persisted Eval' });
defineEval({ id: 'errored-eval', title: 'Errored Eval' });
`,
    );

    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_old123',
        'run.json',
      ),
      JSON.stringify(
        {
          id: '2026-04-21T12-00-00Z_old123',
          shortId: 'r0',
          status: 'completed',
          startedAt: '2026-04-21T12:00:00.000Z',
          endedAt: '2026-04-21T12:00:02.000Z',
          target: { mode: 'evalIds', evalIds: ['persisted-eval'] },
          trials: 1,
          cacheMode: 'use',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_old123',
        'summary.json',
      ),
      JSON.stringify(
        {
          runId: '2026-04-21T12-00-00Z_old123',
          status: 'completed',
          totalCases: 1,
          passedCases: 0,
          failedCases: 1,
          errorCases: 0,
          cancelledCases: 0,
          averageScore: 0,
          totalDurationMs: 2000,
          cost: { totalUsd: 0.12 },
          errorMessage: null,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-00-00Z_old123',
        'cases.jsonl',
      ),
      `${JSON.stringify({
        caseId: 'saved-case',
        evalId: 'persisted-eval',
        status: 'fail',
        score: 0,
        latencyMs: 234,
        costUsd: 0.12,
        columns: {},
        trial: 0,
      })}
`,
    );

    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-05-00Z_new456',
        'run.json',
      ),
      JSON.stringify(
        {
          id: '2026-04-21T12-05-00Z_new456',
          shortId: 'r1',
          status: 'error',
          startedAt: '2026-04-21T12:05:00.000Z',
          endedAt: '2026-04-21T12:05:01.000Z',
          target: {
            mode: 'evalIds',
            evalIds: ['persisted-eval', 'errored-eval'],
          },
          trials: 1,
          cacheMode: 'use',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-05-00Z_new456',
        'summary.json',
      ),
      JSON.stringify(
        {
          runId: '2026-04-21T12-05-00Z_new456',
          status: 'error',
          totalCases: 1,
          passedCases: 1,
          failedCases: 0,
          errorCases: 0,
          cancelledCases: 0,
          averageScore: 1,
          totalDurationMs: 1000,
          cost: { totalUsd: 0.08 },
          errorMessage: '[errored-eval] import failed',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-21T12-05-00Z_new456',
        'cases.jsonl',
      ),
      `${JSON.stringify({
        caseId: 'new-case',
        evalId: 'persisted-eval',
        status: 'pass',
        score: 1,
        latencyMs: 120,
        costUsd: 0.08,
        columns: {},
        trial: 0,
      })}
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getEval('persisted-eval')?.lastRunStatus).toBe('pass');
      expect(runner.getEval('errored-eval')?.lastRunStatus).toBe('error');
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('defaults score passThreshold to 0.5 when omitted', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-default-threshold-'),
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
      join(workspacePath, 'evals', 'default-threshold.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'default-threshold-eval',
  title: 'Default Threshold Eval',
  cases: [{ id: 'below-default-threshold', input: {} }],
  execute: async () => {},
  scores: {
    quality: {
      label: 'Quality',
      compute: () => 0.2,
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
      expect(run?.cases).toMatchObject([
        {
          caseId: 'below-default-threshold',
          evalId: 'default-threshold-eval',
          status: 'fail',
          score: 0.2,
        },
      ]);
      expect(runner.getEval('default-threshold-eval')?.lastRunStatus).toBe(
        'fail',
      );
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);
});
