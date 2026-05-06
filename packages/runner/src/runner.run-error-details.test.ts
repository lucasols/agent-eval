import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SseEnvelope } from '@agent-evals/shared';
import { afterEach, expect, test } from 'vitest';
import { startRunChild, type RunnerRunState } from './runChildManager.ts';
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

test('persists full run error details for eval load failures', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-load-error-details-'),
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
    join(workspacePath, 'evals', 'broken.eval.ts'),
    `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'broken-eval',
  cases: [{ id: 'never-runs', input: {} }],
  execute: async () => {},
});

throw new Error('top-level import exploded');
`,
  );

  const previousCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    const startedRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['broken-eval'] },
      trials: 1,
    });

    await expect
      .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('error');

    const run = runner.getRun(startedRun.manifest.id);
    expect(run?.summary.errorMessage).toContain(
      '[broken-eval] Error: top-level import exploded',
    );
    expect(run?.summary.errorMessage).toContain('broken.eval.ts');
  } finally {
    process.chdir(previousCwd);
  }
}, 10_000);

test('persists child stderr when the run child exits before sending a terminal event', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-child-exit-details-'),
  );
  createdWorkspaces.push(workspacePath);

  const runDir = join(workspacePath, '.agent-evals', 'runs', 'broken-child');
  await mkdir(runDir, { recursive: true });
  const contextPath = join(runDir, 'run-child-context.json');
  await writeFile(contextPath, '{ definitely not json');

  const runState: RunnerRunState = {
    runDir,
    manifest: {
      id: 'broken-child',
      shortId: 'r0',
      status: 'running',
      temporary: false,
      startedAt: new Date().toISOString(),
      endedAt: null,
      commitSha: null,
      evalSourceFingerprints: {},
      target: { mode: 'all' },
      trials: 1,
      trialSelection: 'lowestScore',
      cacheMode: 'use',
    },
    summary: {
      runId: 'broken-child',
      status: 'running',
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
      errorCases: 0,
      cancelledCases: 0,
      totalDurationMs: null,
      errorMessage: null,
    },
    cases: [],
    caseDetails: new Map(),
    listeners: new Set(),
    childProcess: undefined,
    childTerminalReceived: false,
  };
  const emittedEvents: SseEnvelope[] = [];

  startRunChild({
    runState,
    contextPath,
    managerContext: {
      workspaceRoot: workspacePath,
      evals: new Map(),
      emitEvent(_runState, event) {
        emittedEvents.push(event);
      },
      emitDiscoveryEvent() {},
    },
  });

  await expect
    .poll(() => runState.manifest.status, { timeout: 10_000 })
    .toBe('error');

  expect(runState.summary.errorMessage).toContain(
    'Run child exited with code 1',
  );
  expect(runState.summary.errorMessage).toContain('Child stderr');
  expect(runState.summary.errorMessage).toContain('SyntaxError');
  expect(emittedEvents.at(-1)).toMatchObject({ type: 'run.error' });
}, 10_000);
