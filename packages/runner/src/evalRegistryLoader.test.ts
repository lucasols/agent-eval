import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  test('does not isolate installed node_modules dependencies', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-registry-dependency-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'node_modules', 'stable-dependency'), {
      recursive: true,
    });
    await writeFile(
      join(workspacePath, 'node_modules', 'stable-dependency', 'package.json'),
      JSON.stringify({ name: 'stable-dependency', main: 'index.js' }),
    );
    await writeFile(
      join(workspacePath, 'node_modules', 'stable-dependency', 'index.js'),
      `globalThis.__agentEvalsStableDependencyLoads =
  (globalThis.__agentEvalsStableDependencyLoads ?? 0) + 1;

exports.loadCount = globalThis.__agentEvalsStableDependencyLoads;
`,
    );

    const evalPath = join(workspacePath, 'dependency.eval.ts');
    await writeFile(
      evalPath,
      `import { defineEval } from '@agent-evals/sdk';
import stableDependency from 'stable-dependency';

defineEval({
  id: 'dependency-eval',
  title: String(stableDependency.loadCount),
});
`,
    );

    const firstRegistry = await loadIsolatedEvalRegistry({
      evalFilePath: evalPath,
      sourceFingerprint: 'dependency-first',
      moduleIsolation: {
        key: 'dependency:first',
        workspaceRoot: workspacePath,
      },
      runtimeScope: 'env',
    });
    const secondRegistry = await loadIsolatedEvalRegistry({
      evalFilePath: evalPath,
      sourceFingerprint: 'dependency-second',
      moduleIsolation: {
        key: 'dependency:second',
        workspaceRoot: workspacePath,
      },
      runtimeScope: 'env',
    });

    expect(firstRegistry.get('dependency-eval')?.title).toBe('1');
    expect(secondRegistry.get('dependency-eval')?.title).toBe('1');
  });
});
