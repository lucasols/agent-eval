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

describe('createRunner concurrency', () => {
  test('runs cases concurrently up to the configured concurrency limit', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-concurrency-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  concurrency: 2,
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'concurrency.eval.ts'),
      `import { defineEval, setOutput } from '@agent-evals/sdk';

declare global {
  var __agentEvalsConcurrencyTracker:
    | { current: number; max: number }
    | undefined;
}

const tracker = (globalThis.__agentEvalsConcurrencyTracker ??= {
  current: 0,
  max: 0,
});

defineEval({
  id: 'concurrency-eval',
  title: 'Concurrency Eval',
  cases: [
    { id: 'case-a', input: {} },
    { id: 'case-b', input: {} },
    { id: 'case-c', input: {} },
  ],
  execute: async () => {
    tracker.current += 1;
    tracker.max = Math.max(tracker.max, tracker.current);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 120);
    });
    setOutput('maxConcurrency', tracker.max);
    tracker.current -= 1;
  },
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    Reflect.set(globalThis, '__agentEvalsConcurrencyTracker', undefined);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const startedRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['concurrency-eval'] },
        trials: 1,
      });

      await expect
        .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      const run = runner.getRun(startedRun.manifest.id);
      expect(run?.cases).toHaveLength(3);
      const observedConcurrency = (run?.cases ?? [])
        .map((caseRow) => caseRow.columns.maxConcurrency)
        .filter((value): value is number => typeof value === 'number');
      expect(observedConcurrency).toHaveLength(3);
      expect(Math.max(...observedConcurrency)).toBe(2);
    } finally {
      Reflect.set(globalThis, '__agentEvalsConcurrencyTracker', undefined);
      process.chdir(previousCwd);
    }
  }, 10_000);
});
