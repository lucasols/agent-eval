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

describe('runtime output columns', () => {
  test('keeps runtime-only output columns out of eval metadata', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-runtime-columns-'),
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
      join(workspacePath, 'evals', 'runtime-columns.eval.ts'),
      `import { defineEval, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'runtime-columns',
  columns: {
    configured: { label: 'Configured', format: 'markdown' },
  },
  cases: [{ id: 'case-1', input: {} }],
  execute: () => {
    setEvalOutput('configured', 'ok');
    setEvalOutput('rawToolEvents', [{ name: 'receipt-match' }]);
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
        target: { mode: 'evalIds', evalIds: ['runtime-columns'] },
        trials: 1,
      });

      await expect
        .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      expect(
        runner.getCaseDetail(startedRun.manifest.id, 'case-1')?.columns,
      ).toMatchObject({
        configured: 'ok',
        rawToolEvents: [{ name: 'receipt-match' }],
      });
      expect(
        runner.getEval('runtime-columns')?.columnDefs.map((def) => def.key),
      ).toEqual([
        'apiCalls',
        'costUsd',
        'llmTurns',
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'cachedInputTokens',
        'cacheCreationInputTokens',
        'reasoningTokens',
        'llmDurationMs',
        'configured',
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  }, 10_000);
});
