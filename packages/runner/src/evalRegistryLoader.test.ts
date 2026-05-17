import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { loadIsolatedEvalRegistry } from './evalRegistryLoader.ts';

const createdWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdWorkspaces.map(async (workspacePath) => {
      await rm(workspacePath, { recursive: true, force: true });
    }),
  );
  createdWorkspaces.length = 0;
});

describe('loadIsolatedEvalRegistry', () => {
  test('keeps Agent Eval package internals on the runner registry instance', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-registry-loader-'),
    );
    createdWorkspaces.push(workspacePath);

    const evalPath = join(workspacePath, 'isolated-package.eval.ts');
    await writeFile(
      evalPath,
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'isolated-package-eval',
});
`,
    );

    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const registry = await loadIsolatedEvalRegistry({
      evalFilePath: evalPath,
      sourceFingerprint: 'registry-loader-package-internals',
      moduleIsolation: {
        key: 'registry-loader:package-internals',
        workspaceRoot: repoRoot,
      },
      runtimeScope: 'env',
    });

    expect([...registry.keys()]).toEqual(['isolated-package-eval']);
  });
});
