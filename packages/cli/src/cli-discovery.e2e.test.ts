import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  normalizeTextSnapshot,
  repoRoot,
  runExampleCli,
  runWorkspaceCommand,
} from './cliTestUtils.ts';

describe('CLI discovery', () => {
  test('lists evals from a workspace without depending on the example catalog', async () => {
    await withIsolatedDiscoveryWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, ['list']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Alpha Eval');
      expect(result.stdout).toContain('alpha-eval');
      expect(result.stdout).toContain('Covers the happy-path alpha workflow');
      expect(result.stdout).toContain('Beta Eval');
      expect(result.stdout).toContain('beta-eval');
      expect(normalizeTextSnapshot(workspacePath, result.stdout))
        .toMatchInlineSnapshot(`
        "Discovered evals:

          Alpha Eval
            description: Covers the happy-path alpha workflow
            id: alpha-eval
            file: evals/alpha.eval.ts

          Beta Eval
            id: beta-eval
            file: evals/nested/beta.eval.ts"
      `);
    });
  });

  test('shows outdated freshness when the latest run is old and from another commit', async () => {
    await withIsolatedDiscoveryWorkspace(async (workspacePath) => {
      expect(
        (await runWorkspaceCommand(workspacePath, 'git', ['init'])).exitCode,
      ).toBe(0);
      expect(
        (
          await runWorkspaceCommand(workspacePath, 'git', [
            'config',
            'user.email',
            'ci@example.com',
          ])
        ).exitCode,
      ).toBe(0);
      expect(
        (
          await runWorkspaceCommand(workspacePath, 'git', [
            'config',
            'user.name',
            'CI',
          ])
        ).exitCode,
      ).toBe(0);
      expect(
        (await runWorkspaceCommand(workspacePath, 'git', ['add', '.']))
          .exitCode,
      ).toBe(0);
      expect(
        (
          await runWorkspaceCommand(workspacePath, 'git', [
            'commit',
            '-m',
            'initial',
          ])
        ).exitCode,
      ).toBe(0);

      const runPath = join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-01T12-00-00Z_outdated',
      );
      await mkdir(join(runPath, 'case-details'), { recursive: true });
      await writeFile(
        join(runPath, 'run.json'),
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
              evalKeys: ['evals%2Falpha.eval.ts#alpha-eval'],
            },
            trials: 1,
            trialSelection: 'lowestScore',
            cacheMode: 'use',
          },
          null,
          2,
        ),
      );
      await writeFile(
        join(runPath, 'summary.json'),
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
        join(runPath, 'cases.jsonl'),
        `${JSON.stringify({
          caseId: 'alpha-case',
          evalId: 'alpha-eval',
          evalKey: 'evals%2Falpha.eval.ts#alpha-eval',
          status: 'pass',
          durationMs: 120,
          costUsd: 0.01,
          columns: {},
          trial: 0,
        })}
`,
      );

      const result = await runExampleCli(workspacePath, ['list']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Alpha Eval');
      expect(result.stdout).toContain('status: outdated');
    });
  });
});

async function withIsolatedDiscoveryWorkspace<T>(
  fn: (workspacePath: string) => Promise<T>,
): Promise<T> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-cli-discovery-'),
  );

  try {
    await createDiscoveryFixture(workspacePath);
    return await fn(workspacePath);
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

async function createDiscoveryFixture(workspacePath: string): Promise<void> {
  await mkdir(join(workspacePath, 'evals', 'nested'), { recursive: true });
  await mkdir(join(workspacePath, 'node_modules', '@ls-stack'), {
    recursive: true,
  });
  await symlink(
    resolve(repoRoot, 'packages/cli'),
    join(workspacePath, 'node_modules', '@ls-stack', 'agent-eval'),
  );
  await writeFile(
    join(workspacePath, 'agent-evals.config.ts'),
    `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
  );
  await writeFile(join(workspacePath, '.gitignore'), 'node_modules\n');
  await writeFile(
    join(workspacePath, 'evals', 'alpha.eval.ts'),
    `import { defineEval } from '@ls-stack/agent-eval';

defineEval({
  id: 'alpha-eval',
  title: 'Alpha Eval',
  description: 'Covers the happy-path alpha workflow',
  cases: [{ id: 'alpha-case', input: {} }],
});
`,
  );
  await writeFile(
    join(workspacePath, 'evals', 'nested', 'beta.eval.ts'),
    `import { defineEval } from '@ls-stack/agent-eval';

defineEval({
  id: 'beta-eval',
  title: 'Beta Eval',
  cases: [{ id: 'beta-case', input: {} }],
});
`,
  );
}
