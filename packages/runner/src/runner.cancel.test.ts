import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runManifestSchema,
  runSummarySchema,
  type SseEnvelope,
} from '@agent-evals/shared';
import { resultify } from 't-result';
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

async function readStartedCases(logPath: string): Promise<string[]> {
  if (!existsSync(logPath)) return [];
  const raw = await readFile(logPath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readPersistedStatuses(params: {
  runDir: string;
}): Promise<{ manifestStatus: string; summaryStatus: string } | null> {
  const manifestResult = await resultify(async () =>
    runManifestSchema.parse(
      JSON.parse(await readFile(join(params.runDir, 'run.json'), 'utf-8')),
    ),
  );
  if (manifestResult.error) return null;

  const summaryResult = await resultify(async () =>
    runSummarySchema.parse(
      JSON.parse(await readFile(join(params.runDir, 'summary.json'), 'utf-8')),
    ),
  );
  if (summaryResult.error) return null;

  return {
    manifestStatus: manifestResult.value.status,
    summaryStatus: summaryResult.value.status,
  };
}

describe('runner.cancelRun', () => {
  test('persists cancelled runs by killing the child process without emitting finished', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-cancel-'),
    );
    createdWorkspaces.push(workspacePath);

    const startedLogPath = join(workspacePath, 'started-cases.log');

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  concurrency: 1,
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'cancel.eval.ts'),
      `import { appendFile } from 'node:fs/promises';
import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'cancel-eval',
  title: 'Cancel Eval',
  cases: [
    { id: 'case-a', input: { id: 'case-a' } },
    { id: 'case-b', input: { id: 'case-b' } },
    { id: 'case-c', input: { id: 'case-c' } },
  ],
  execute: async ({ input }) => {
    await appendFile(${JSON.stringify(startedLogPath)}, \`\${input.id}\\n\`);
    await new Promise<void>(() => {});
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
        target: { mode: 'evalIds', evalIds: ['cancel-eval'] },
        trials: 1,
      });
      const events: SseEnvelope[] = [];
      const unsubscribe = runner.subscribe(startedRun.manifest.id, (event) => {
        events.push(event);
      });

      await expect
        .poll(() => readStartedCases(startedLogPath), { timeout: 10_000 })
        .toEqual(['case-a']);
      await expect
        .poll(
          () =>
            runner
              .getRun(startedRun.manifest.id)
              ?.cases.map((caseRow) => `${caseRow.caseId}:${caseRow.status}`)
              .toSorted(),
          { timeout: 10_000 },
        )
        .toEqual(['case-a:running', 'case-b:pending', 'case-c:pending']);

      await runner.cancelRun(startedRun.manifest.id);

      unsubscribe();

      const run = runner.getRun(startedRun.manifest.id);
      expect(run?.manifest.status).toBe('cancelled');
      expect(run?.summary.status).toBe('cancelled');
      expect(run?.cases).toHaveLength(0);
      expect(await readStartedCases(startedLogPath)).toEqual(['case-a']);
      expect(events.map((event) => event.type)).not.toContain('run.finished');
      expect(events.map((event) => event.type)).toContain('run.cancelled');

      const runDir = join(
        workspacePath,
        '.agent-evals',
        'runs',
        startedRun.manifest.id,
      );
      await expect
        .poll(() => readPersistedStatuses({ runDir }), { timeout: 10_000 })
        .toEqual({ manifestStatus: 'cancelled', summaryStatus: 'cancelled' });
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('keeps finished case results while leaving queued cases unstarted', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-cancel-finished-'),
    );
    createdWorkspaces.push(workspacePath);

    const startedLogPath = join(workspacePath, 'started-cases.log');

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  concurrency: 1,
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'cancel-finished.eval.ts'),
      `import { appendFile } from 'node:fs/promises';
import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'cancel-finished-eval',
  title: 'Cancel Finished Eval',
  cases: [
    { id: 'case-a', input: { id: 'case-a' } },
    { id: 'case-b', input: { id: 'case-b' } },
    { id: 'case-c', input: { id: 'case-c' } },
  ],
  execute: async ({ input }) => {
    await appendFile(${JSON.stringify(startedLogPath)}, \`\${input.id}\\n\`);
    if (input.id === 'case-a') return { finished: input.id };
    await new Promise<void>(() => {});
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
        target: { mode: 'evalIds', evalIds: ['cancel-finished-eval'] },
        trials: 1,
      });

      await expect
        .poll(
          () =>
            runner
              .getRun(startedRun.manifest.id)
              ?.cases.map((caseRow) => `${caseRow.caseId}:${caseRow.status}`)
              .toSorted(),
          { timeout: 10_000 },
        )
        .toEqual(['case-a:pass', 'case-b:running', 'case-c:pending']);
      await expect
        .poll(() => readStartedCases(startedLogPath), { timeout: 10_000 })
        .toEqual(['case-a', 'case-b']);

      await runner.cancelRun(startedRun.manifest.id);

      const run = runner.getRun(startedRun.manifest.id);
      expect(run?.manifest.status).toBe('cancelled');
      expect(run?.summary.status).toBe('cancelled');
      expect(run?.summary.totalCases).toBe(1);
      expect(run?.summary.passedCases).toBe(1);
      expect(run?.cases.map((caseRow) => caseRow.caseId)).toEqual(['case-a']);
      expect(await readStartedCases(startedLogPath)).toEqual([
        'case-a',
        'case-b',
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);
});
