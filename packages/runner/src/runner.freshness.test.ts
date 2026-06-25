import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  test('discovers eval files inside the run child process', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-child-discovery-'),
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

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    let runner: ReturnType<typeof createRunner> | undefined;

    try {
      const activeRunner = createRunner({ watchForChanges: false });
      runner = activeRunner;
      await activeRunner.init();
      expect(activeRunner.getEvals()).toEqual([]);

      await writeFile(
        join(workspacePath, 'evals', 'created-after-init.eval.ts'),
        `import { defineEval, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'created-after-init',
  title: 'Created After Init',
  cases: [{ id: 'case-1', input: {} }],
  execute: async () => {
    setEvalOutput('answer', 'fresh');
  },
});
`,
      );

      const run = await activeRunner.startRun({
        target: { mode: 'all' },
        trials: 1,
      });
      await expect
        .poll(() => activeRunner.getRun(run.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      expect(activeRunner.getRun(run.manifest.id)?.summary).toMatchObject({
        totalCases: 1,
        passedCases: 1,
      });
      expect(activeRunner.getEval('created-after-init')).toMatchObject({
        id: 'created-after-init',
        title: 'Created After Init',
      });
    } finally {
      await runner?.close();
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('reports env during run-time module evaluation and eval during execute', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-runtime-scope-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await mkdir(join(workspacePath, 'src'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
    );
    await writeFile(
      join(workspacePath, 'src', 'runtimeScope.ts'),
      `import { isInEvalScope } from '@agent-evals/sdk';

export const scopeAtModuleLoad = isInEvalScope();

export function getScopeAtCall() {
  return isInEvalScope();
}
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'runtime-scope.eval.ts'),
      `import { defineEval, setEvalOutput } from '@agent-evals/sdk';
import { getScopeAtCall, scopeAtModuleLoad } from '../src/runtimeScope.ts';

defineEval({
  id: 'runtime-scope',
  title: 'Runtime Scope',
  cases: [{ id: 'case-1', input: {} }],
  execute: () => {
    setEvalOutput('scopeAtModuleLoad', scopeAtModuleLoad);
    setEvalOutput('scopeAtCall', getScopeAtCall());
  },
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    let runner: ReturnType<typeof createRunner> | undefined;

    try {
      const activeRunner = createRunner({ watchForChanges: false });
      runner = activeRunner;
      await activeRunner.init();

      const run = await activeRunner.startRun({
        target: { mode: 'all' },
        trials: 1,
      });
      await expect
        .poll(() => activeRunner.getRun(run.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      expect(
        activeRunner.getCaseDetail(run.manifest.id, 'case-1')?.columns,
      ).toMatchObject({ scopeAtCall: 'eval', scopeAtModuleLoad: 'env' });
    } finally {
      await runner?.close();
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('runs each eval case in a fresh child process', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-case-child-'),
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
      join(workspacePath, 'evals', 'process-isolation.eval.ts'),
      `import { defineEval, evalAssert, setEvalOutput } from '@agent-evals/sdk';

let executionCount = 0;

defineEval({
  id: 'process-isolation',
  title: 'Process Isolation',
  cases: [
    { id: 'case-1', input: {} },
    { id: 'case-2', input: {} },
  ],
  execute: () => {
    executionCount += 1;
    setEvalOutput('pid', process.pid);
    setEvalOutput('executionCount', executionCount);
    evalAssert(executionCount === 1, 'case process should start with fresh module state');
  },
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    let runner: ReturnType<typeof createRunner> | undefined;

    try {
      const activeRunner = createRunner({ watchForChanges: false });
      runner = activeRunner;
      await activeRunner.init();

      const run = await activeRunner.startRun({
        target: { mode: 'evalIds', evalIds: ['process-isolation'] },
        trials: 1,
      });
      await expect
        .poll(() => activeRunner.getRun(run.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      const firstCase = activeRunner.getCaseDetail(run.manifest.id, 'case-1');
      const secondCase = activeRunner.getCaseDetail(run.manifest.id, 'case-2');

      expect(firstCase?.columns.executionCount).toBe(1);
      expect(secondCase?.columns.executionCount).toBe(1);
      expect(firstCase?.columns.pid).not.toBe(secondCase?.columns.pid);
    } finally {
      await runner?.close();
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('reloads workspace modules between runs in the same runner process', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-module-isolation-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await mkdir(join(workspacePath, 'src'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
    );
    await writeFile(
      join(workspacePath, 'src', 'dbState.ts'),
      `import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const initialized = existsSync(resolve(process.cwd(), 'db-ready.txt'));

export function getDbStatus(): 'ready' | 'missing' {
  return initialized ? 'ready' : 'missing';
}
`,
    );
    await writeFile(
      join(workspacePath, 'src', 'cjsState.cjs'),
      `const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const initialized = existsSync(resolve(process.cwd(), 'cjs-ready.txt'));

module.exports = {
  getCjsStatus() {
    return initialized ? 'ready' : 'missing';
  },
};
`,
    );
    const sdkModuleUrl = pathToFileURL(
      join(dirname(fileURLToPath(import.meta.url)), '../../sdk/src/index.ts'),
    ).href;
    await writeFile(
      join(workspacePath, 'evals', 'db.eval.ts'),
      `import { defineEval, evalAssert, setEvalOutput } from ${JSON.stringify(sdkModuleUrl)};
import cjsState from '../src/cjsState.cjs';
import { getDbStatus } from '../src/dbState.ts';

defineEval({
  id: 'db-isolation-eval',
  title: 'DB Isolation Eval',
  cases: [{ id: 'case-1', input: {} }],
  execute: async () => {
    const status = getDbStatus();
    const cjsStatus = cjsState.getCjsStatus();
    setEvalOutput('dbStatus', status);
    setEvalOutput('cjsStatus', cjsStatus);
    evalAssert(status === 'ready', 'db should be initialized');
    evalAssert(cjsStatus === 'ready', 'cjs module should be initialized');
  },
});
`,
    );

    const runnerModuleUrl = pathToFileURL(
      join(dirname(fileURLToPath(import.meta.url)), 'runner.ts'),
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRunner } from ${JSON.stringify(runnerModuleUrl)};

const runner = createRunner({ watchForChanges: false });
await runner.init();

async function waitForRun(runId) {
  while (true) {
    const run = runner.getRun(runId);
    const status = run?.manifest.status;
    if (status === 'completed' || status === 'cancelled' || status === 'error') {
      return run;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

const firstRun = await runner.startRun({
  target: { mode: 'evalIds', evalIds: ['db-isolation-eval'] },
  trials: 1,
});
const first = await waitForRun(firstRun.manifest.id);

await writeFile(join(process.cwd(), 'db-ready.txt'), 'ready\\n');
await writeFile(join(process.cwd(), 'cjs-ready.txt'), 'ready\\n');

const secondRun = await runner.startRun({
  target: { mode: 'evalIds', evalIds: ['db-isolation-eval'] },
  trials: 1,
});
const second = await waitForRun(secondRun.manifest.id);

console.log(JSON.stringify({
  first: first?.summary,
  second: second?.summary,
}));
`,
      ],
      {
        cwd: workspacePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(result.status, result.stderr).toBe(0);

    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      first: { failedCases: 1, passedCases: 0 },
      second: { failedCases: 0, passedCases: 1 },
    });
  });

  test('rerunning after the same eval-file change clears stale', async () => {
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

      await writeFile(
        join(workspacePath, 'evals', 'stale-reset.eval.ts'),
        `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'stale-reset-eval',
  title: 'Stale Reset Eval (updated)',
  cases: [{ id: 'case-1', input: {} }],
  execute: async () => {},
});
`,
      );
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

  test('can mark a stale eval as not stale without rerunning', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-mark-not-stale-'),
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
      join(workspacePath, 'evals', 'mark-fresh.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'mark-fresh-eval',
  title: 'Mark Fresh Eval',
  cases: [{ id: 'case-1', input: {} }],
  execute: async () => {},
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const firstRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['mark-fresh-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => runner.getRun(firstRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      await writeFile(
        join(workspacePath, 'evals', 'mark-fresh.eval.ts'),
        `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'mark-fresh-eval',
  title: 'Mark Fresh Eval (reviewed)',
  cases: [{ id: 'case-1', input: {} }],
  execute: async () => {},
});
`,
      );
      await runner.refreshDiscovery();

      expect(runner.getEval('mark-fresh-eval')).toMatchObject({
        stale: true,
        freshnessStatus: 'stale',
        lastRunStatus: 'pass',
      });

      const markResult = await runner.markEvalNotStale('mark-fresh-eval');
      expect(markResult.updated).toBe(true);
      if (!markResult.updated) {
        throw new Error(`Expected mark to update, got ${markResult.reason}`);
      }
      expect(markResult.eval).toMatchObject({
        stale: false,
        freshnessStatus: 'fresh',
        lastRunStatus: 'pass',
      });
      expect(runner.getEval('mark-fresh-eval')).toMatchObject({
        stale: false,
        freshnessStatus: 'fresh',
        lastRunStatus: 'pass',
      });

      const secondRunner = createRunner({ watchForChanges: false });
      await secondRunner.init();
      expect(secondRunner.getEval('mark-fresh-eval')).toMatchObject({
        stale: false,
        freshnessStatus: 'fresh',
        lastRunStatus: 'pass',
      });
      await secondRunner.close();
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('records the current git branch on created runs', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-branch-name-'),
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
      join(workspacePath, 'evals', 'branch.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'branch-eval',
  title: 'Branch Eval',
  cases: [{ id: 'case-1', input: {} }],
  execute: async () => {},
});
`,
    );
    runGit(workspacePath, ['init']);
    runGit(workspacePath, ['config', 'user.email', 'ci@example.com']);
    runGit(workspacePath, ['config', 'user.name', 'CI']);
    runGit(workspacePath, ['add', '.']);
    runGit(workspacePath, ['commit', '-m', 'initial']);
    runGit(workspacePath, ['checkout', '-b', 'feature/branch-recording']);

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    let runner: ReturnType<typeof createRunner> | undefined;

    try {
      const activeRunner = createRunner({ watchForChanges: false });
      runner = activeRunner;
      await activeRunner.init();

      const run = await activeRunner.startRun({
        target: { mode: 'evalIds', evalIds: ['branch-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => activeRunner.getRun(run.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      expect(activeRunner.getRun(run.manifest.id)?.manifest).toMatchObject({
        branchName: 'feature/branch-recording',
      });
    } finally {
      await runner?.close();
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('marks an eval outdated when its latest run is old and from another commit', async () => {
    const evalKey = 'evals%2Foutdated.eval.ts#outdated-eval';
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
          target: {
            mode: 'evalIds',
            evalIds: ['outdated-eval'],
            evalKeys: [evalKey],
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
          totalDurationMs: 2000,
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
        evalKey,
        status: 'pass',
        durationMs: 234,
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
