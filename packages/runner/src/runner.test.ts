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
  test(
    'emits discovery updates after refreshing changed eval files',
    async () => {
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
    },
    10_000,
  );
});
