import { spawnSync } from 'node:child_process';
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

function runGit(workspacePath: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: workspacePath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(result.status).toBe(0);
}

describe('runner freshness', () => {
  test('rerunning in the same dirty tracked state clears stale', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-stale-reset-'),
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
      join(workspacePath, 'evals', 'stale-reset.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'stale-reset-eval',
  title: 'Stale Reset Eval',
  cases: [{ id: 'case-1', input: {} }],
  execute: async () => {},
});
`,
    );
    await writeFile(join(workspacePath, 'notes.txt'), 'original\n');

    runGit(workspacePath, ['init']);
    runGit(workspacePath, ['config', 'user.email', 'ci@example.com']);
    runGit(workspacePath, ['config', 'user.name', 'CI']);
    runGit(workspacePath, ['add', '.']);
    runGit(workspacePath, ['commit', '-m', 'initial']);

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const firstRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['stale-reset-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => runner.getRun(firstRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      expect(runner.getEval('stale-reset-eval')).toMatchObject({
        stale: false,
        outdated: false,
        freshnessStatus: 'fresh',
        lastRunStatus: 'pass',
      });

      await writeFile(join(workspacePath, 'notes.txt'), 'modified\n');
      await runner.refreshDiscovery();

      expect(runner.getEval('stale-reset-eval')).toMatchObject({
        stale: true,
        outdated: false,
        freshnessStatus: 'stale',
        lastRunStatus: 'pass',
      });

      const secondRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['stale-reset-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => runner.getRun(secondRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      expect(runner.getEval('stale-reset-eval')).toMatchObject({
        stale: false,
        outdated: false,
        freshnessStatus: 'fresh',
        lastRunStatus: 'pass',
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('marks an eval outdated when its latest run is old and from another commit', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-outdated-status-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await mkdir(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-01T12-00-00Z_outdated',
        'case-details',
      ),
      { recursive: true },
    );

    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  staleAfterDays: 14,
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'outdated.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'outdated-eval',
  title: 'Outdated Eval',
});
`,
    );

    runGit(workspacePath, ['init']);
    runGit(workspacePath, ['config', 'user.email', 'ci@example.com']);
    runGit(workspacePath, ['config', 'user.name', 'CI']);
    runGit(workspacePath, ['add', '.']);
    runGit(workspacePath, ['commit', '-m', 'initial']);

    await writeFile(
      join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-01T12-00-00Z_outdated',
        'run.json',
      ),
      JSON.stringify(
        {
          id: '2026-04-01T12-00-00Z_outdated',
          shortId: 'r0',
          status: 'completed',
          startedAt: '2026-04-01T12:00:00.000Z',
          endedAt: '2026-04-01T12:00:02.000Z',
          commitSha: '1111111111111111111111111111111111111111',
          target: { mode: 'evalIds', evalIds: ['outdated-eval'] },
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
        '2026-04-01T12-00-00Z_outdated',
        'summary.json',
      ),
      JSON.stringify(
        {
          runId: '2026-04-01T12-00-00Z_outdated',
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
        '2026-04-01T12-00-00Z_outdated',
        'cases.jsonl',
      ),
      `${JSON.stringify({
        caseId: 'saved-case',
        evalId: 'outdated-eval',
        status: 'pass',
        score: 1,
        latencyMs: 234,
        costUsd: 0.12,
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

      expect(runner.getEval('outdated-eval')).toMatchObject({
        stale: false,
        outdated: true,
        freshnessStatus: 'outdated',
        latestRunCommitSha: '1111111111111111111111111111111111111111',
        lastRunStatus: 'pass',
      });
    } finally {
      process.chdir(previousCwd);
    }
  });
});
