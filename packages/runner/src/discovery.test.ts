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

describe('discovery metadata', () => {
  test('discovers the effective eval pass threshold for UI metadata', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-pass-threshold-'),
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
      join(workspacePath, 'evals', 'threshold.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'threshold-eval',
  title: 'Threshold Eval',
  scores: {
    correctness: {
      compute: () => 1,
      passThreshold: 1,
    },
  },
  passThreshold: 0.85,
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getEval('threshold-eval')?.passThreshold).toBe(0.85);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
