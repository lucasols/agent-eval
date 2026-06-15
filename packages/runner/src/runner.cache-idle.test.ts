import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createRunner } from './runner.ts';

const createdWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdWorkspaces.map((workspacePath) =>
      rm(workspacePath, { recursive: true, force: true }),
    ),
  );
  createdWorkspaces.length = 0;
});

async function waitForRunStatus(
  runner: ReturnType<typeof createRunner>,
  runId: string,
  status: 'completed' | 'cancelled' | 'error',
): Promise<void> {
  await expect
    .poll(() => runner.getRun(runId)?.manifest.status, { timeout: 10_000 })
    .toBe(status);
}

test('prunes cache retention only after the runner stays idle', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-cache-idle-'),
  );
  createdWorkspaces.push(workspacePath);

  await mkdir(join(workspacePath, 'evals'), { recursive: true });
  await writeFile(
    join(workspacePath, 'agent-evals.config.ts'),
    `export default {
  include: ['evals/**/*.eval.ts'],
  cache: { maxBytes: 1, pruneIdleDelayMs: 500 },
};
`,
  );
  await writeFile(
    join(workspacePath, 'evals', 'idle-cache.eval.ts'),
    `import { defineEval, evalTracer } from '@agent-evals/sdk';

defineEval({
  id: 'idle-cache',
  cases: [
    { id: 'first', input: { key: 'first' } },
    { id: 'second', input: { key: 'second' } },
  ],
  execute: async ({ input }) => {
    await evalTracer.span(
      {
        kind: 'tool',
        name: 'cached-work',
        cache: { namespace: 'idle-cache.work', key: input.key },
      },
      () => input.key,
    );
  },
});
`,
  );

  const previousCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    const firstRun = await runner.startRun({
      target: { mode: 'caseIds', evalIds: ['idle-cache'], caseIds: ['first'] },
      trials: 1,
      cache: { mode: 'use' },
    });
    await waitForRunStatus(runner, firstRun.manifest.id, 'completed');
    expect(await runner.listCache()).toHaveLength(1);

    const secondRun = await runner.startRun({
      target: { mode: 'caseIds', evalIds: ['idle-cache'], caseIds: ['second'] },
      trials: 1,
      cache: { mode: 'use' },
    });
    await waitForRunStatus(runner, secondRun.manifest.id, 'completed');

    expect(await runner.listCache()).toHaveLength(2);
    await expect
      .poll(() => runner.listCache(), { timeout: 2_000 })
      .toHaveLength(0);

    await runner.close();
  } finally {
    process.chdir(previousCwd);
  }
});
