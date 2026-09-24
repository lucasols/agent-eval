import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cacheListItemSchema } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  runExampleCli,
  runWorkspaceCommand,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

const cacheListSchema = z.array(cacheListItemSchema);
const pruneSummarySchema = z.object({
  baseRef: z.string(),
  baseRefSource: z.enum(['flag', 'config', 'pullRequest']),
  mergeBase: z.string(),
  dryRun: z.boolean(),
  removed: cacheListSchema,
  keptLatestRunEntries: z.number(),
  keptBaseEntries: z.number(),
});

test('cache prune-branch removes branch-added entries not used by the latest runs', async () => {
  await withIsolatedExampleWorkspace(async (workspacePath) => {
    const git = async (args: string[]) => {
      const result = await runWorkspaceCommand(workspacePath, 'git', [
        '-c',
        'user.name=Agent Evals',
        '-c',
        'user.email=agent-evals@example.com',
        ...args,
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
    };
    const runSimpleText = async () => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
    };
    const listCacheKeys = async () => {
      const listed = await runExampleCli(workspacePath, [
        'cache',
        'list',
        '--json',
      ]);
      return cacheListSchema
        .parse(JSON.parse(listed.stdout))
        .map((entry) => entry.key)
        .sort();
    };
    const pruneBranch = async (args: string[]) => {
      const result = await runExampleCli(workspacePath, [
        'cache',
        'prune-branch',
        '--json',
        ...args,
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      return pruneSummarySchema.parse(JSON.parse(result.stdout));
    };

    // The isolated workspace has no remote, so the fallback points at `main`.
    const configPath = resolve(workspacePath, 'agent-evals.config.ts');
    await writeFile(
      configPath,
      (await readFile(configPath, 'utf8')).replace(
        "branchPruneBaseRef: 'origin/main'",
        "branchPruneBaseRef: 'main'",
      ),
    );
    await writeFile(
      resolve(workspacePath, '.gitignore'),
      'node_modules\n.agent-evals/*\n!.agent-evals/cache/\n',
    );

    await runSimpleText();
    const [baseKey] = await listCacheKeys();
    await git(['init', '--quiet', '--initial-branch', 'main']);
    await git(['add', '.']);
    await git(['commit', '--quiet', '-m', 'base']);
    await git(['checkout', '--quiet', '-b', 'feature']);

    const evalPath = resolve(workspacePath, 'evals/refund-workflow.eval.ts');
    const originalSource = await readFile(evalPath, 'utf8');
    const editMessage = (message: string) =>
      writeFile(
        evalPath,
        originalSource.replace('I want a refund for order #123', message),
      );

    await editMessage('I want a refund for order #456');
    await runSimpleText();
    const keysAfterFirstEdit = await listCacheKeys();
    await editMessage('I want a refund for order #789');
    await runSimpleText();
    const staleKey = keysAfterFirstEdit.find((key) => key !== baseKey);
    const latestKey = (await listCacheKeys()).find(
      (key) => key !== baseKey && key !== staleKey,
    );
    expect(staleKey).toBeDefined();
    expect(latestKey).toBeDefined();

    const dryRun = await pruneBranch(['--dry-run']);
    expect(dryRun).toMatchObject({
      baseRef: 'main',
      baseRefSource: 'config',
      dryRun: true,
      keptLatestRunEntries: 1,
      keptBaseEntries: 1,
    });
    expect(
      dryRun.removed.map((entry) => ({
        namespace: entry.namespace,
        key: entry.key,
      })),
    ).toEqual([{ namespace: 'refund-workflow.plan-refund', key: staleKey }]);
    expect(await listCacheKeys()).toHaveLength(3);

    const pruned = await pruneBranch(['--base', 'main']);
    expect(pruned).toMatchObject({
      baseRef: 'main',
      baseRefSource: 'flag',
      dryRun: false,
    });
    expect(pruned.removed.map((entry) => entry.key)).toEqual([staleKey]);
    expect(await listCacheKeys()).toEqual([baseKey, latestKey].sort());

    const missingBase = await runExampleCli(workspacePath, [
      'cache',
      'prune-branch',
      '--base',
      'does-not-exist',
    ]);
    expect(missingBase.exitCode).toBe(1);
    expect(missingBase.stderr).toContain(
      'Base ref "does-not-exist" was not found.',
    );
  });
}, 60_000);
