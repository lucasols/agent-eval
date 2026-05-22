import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createRunner } from './runner.ts';
import { loadPersistedRunSnapshot } from './runPersistence.ts';

const createdWorkspaces: string[] = [];
const persistedEvalKey = 'evals%2Fpersisted.eval.ts#persisted-eval';

afterEach(async () => {
  await Promise.all(
    createdWorkspaces.map(async (workspacePath) => {
      await rm(workspacePath, { recursive: true, force: true });
    }),
  );
  createdWorkspaces.length = 0;
});

describe('persisted eval identity', () => {
  test('loads keyed persisted runs and lazily reads case details', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-persisted-runs-'),
    );
    createdWorkspaces.push(workspacePath);

    const runPath = join(
      workspacePath,
      '.agent-evals',
      'runs',
      '2026-04-21T12-00-00Z_abc123',
    );
    await mkdir(join(runPath, 'case-details'), { recursive: true });
    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default { include: ['evals/**/*.eval.ts'] };\n`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'persisted.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({ id: 'persisted-eval', title: 'Persisted Eval' });
`,
    );
    await writeFile(
      join(runPath, 'run.json'),
      JSON.stringify(
        {
          id: '2026-04-21T12-00-00Z_abc123',
          shortId: 'r0',
          status: 'completed',
          startedAt: '2026-04-21T12:00:00.000Z',
          endedAt: '2026-04-21T12:00:02.000Z',
          target: { mode: 'evalIds', evalKeys: [persistedEvalKey] },
          trials: 1,
          cacheMode: 'use',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(runPath, 'summary.json'),
      JSON.stringify(
        {
          runId: '2026-04-21T12-00-00Z_abc123',
          status: 'completed',
          totalCases: 1,
          passedCases: 1,
          failedCases: 0,
          errorCases: 0,
          cancelledCases: 0,
          totalDurationMs: 2000,
          errorMessage: null,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(runPath, 'cases.jsonl'),
      `${JSON.stringify({
        caseId: 'saved-case',
        evalId: 'persisted-eval',
        evalKey: persistedEvalKey,
        status: 'pass',
        durationMs: 234,
        costUsd: 0.12,
        columns: { answer: 'ok' },
        trial: 0,
      })}\n`,
    );
    await writeFile(
      join(runPath, 'case-details', 'saved-case.json'),
      JSON.stringify(
        {
          caseId: 'saved-case',
          evalId: 'persisted-eval',
          evalKey: persistedEvalKey,
          status: 'pass',
          input: { prompt: 'hi' },
          trace: [],
          traceDisplay: { attributes: [] },
          columns: { answer: 'ok' },
          assertionFailures: [],
          error: null,
          trial: 0,
        },
        null,
        2,
      ),
    );

    const lazySnapshot = await loadPersistedRunSnapshot(runPath);
    expect(lazySnapshot?.caseDetails.size).toBe(0);
    const eagerSnapshot = await loadPersistedRunSnapshot(runPath, {
      includeCaseDetails: true,
    });
    expect(eagerSnapshot?.caseDetails.get('saved-case')).toMatchObject({
      evalKey: persistedEvalKey,
      columns: { answer: 'ok' },
    });

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getRuns()).toHaveLength(1);
      expect(runner.getRun('2026-04-21T12-00-00Z_abc123')).toMatchObject({
        summary: { totalCases: 1, passedCases: 1 },
        cases: [
          { caseId: 'saved-case', evalKey: persistedEvalKey, status: 'pass' },
        ],
      });
      expect(
        runner.getCaseDetail('2026-04-21T12-00-00Z_abc123', 'saved-case'),
      ).toMatchObject({ evalKey: persistedEvalKey, columns: { answer: 'ok' } });
      expect(runner.getEval('persisted-eval')?.lastRunStatus).toBe('pass');
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('ignores persisted eval-id-only rows when deriving eval status', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-no-legacy-status-'),
    );
    createdWorkspaces.push(workspacePath);

    const runPath = join(
      workspacePath,
      '.agent-evals',
      'runs',
      '2026-04-21T12-00-00Z_legacy',
    );
    await mkdir(join(runPath, 'case-details'), { recursive: true });
    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default { include: ['evals/**/*.eval.ts'] };\n`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'legacy.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({ id: 'legacy-eval', title: 'Legacy Eval' });
`,
    );
    await writeFile(
      join(runPath, 'run.json'),
      JSON.stringify(
        {
          id: '2026-04-21T12-00-00Z_legacy',
          shortId: 'r0',
          status: 'completed',
          startedAt: '2026-04-21T12:00:00.000Z',
          endedAt: '2026-04-21T12:00:02.000Z',
          target: { mode: 'evalIds', evalIds: ['legacy-eval'] },
          trials: 1,
          cacheMode: 'use',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(runPath, 'summary.json'),
      JSON.stringify(
        {
          runId: '2026-04-21T12-00-00Z_legacy',
          status: 'completed',
          totalCases: 1,
          passedCases: 0,
          failedCases: 1,
          errorCases: 0,
          cancelledCases: 0,
          totalDurationMs: 2000,
          errorMessage: null,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(runPath, 'cases.jsonl'),
      `${JSON.stringify({
        caseId: 'legacy-case',
        evalId: 'legacy-eval',
        status: 'fail',
        durationMs: 234,
        columns: {},
        trial: 0,
      })}\n`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getRuns()).toHaveLength(1);
      expect(runner.getEval('legacy-eval')?.lastRunStatus).toBe(null);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
