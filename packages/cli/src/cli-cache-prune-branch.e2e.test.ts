import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  keptUnreferencedEntries: z.number(),
  keptNewerThanLatestRunEntries: z.number(),
});

test('cache prune-branch removes branch-added entries only used by superseded runs', async () => {
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
    const runSimpleText = async (extraArgs: string[] = []) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
        ...extraArgs,
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

    // Defer automatic pruning while building the history for the manual command.
    const configPath = resolve(workspacePath, 'agent-evals.config.ts');
    await writeFile(
      configPath,
      (await readFile(configPath, 'utf8')).replace(
        "branchPruneBaseRef: 'origin/main'",
        "branchPruneBaseRef: 'not-configured-yet'",
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

    const runsDir = resolve(workspacePath, '.agent-evals/runs');
    const runEditedCase = async (message: string, extraArgs: string[] = []) => {
      const keysBefore = await listCacheKeys();
      const runsBefore = await readdir(runsDir);
      await editMessage(message);
      await runSimpleText(extraArgs);
      const newKey = (await listCacheKeys()).find(
        (key) => !keysBefore.includes(key),
      );
      const newRunId = (await readdir(runsDir)).find(
        (runId) => !runsBefore.includes(runId),
      );
      expect(newRunId).toBeDefined();
      return { key: newKey, runId: newRunId ?? '' };
    };

    const orphaned = await runEditedCase('I want a refund for order #456');
    const stale = await runEditedCase('I want a refund for order #789');
    const refreshed = await runEditedCase('I want a refund for order #555');
    const latest = await runEditedCase('I want a refund for order #999');
    // Re-store #555 after the latest run started, then drop that run: only the
    // older run references it, but the latest run is older than the cache.
    const refreshRun = await runEditedCase('I want a refund for order #555', [
      '--cache',
      'refresh',
    ]);
    await rm(resolve(runsDir, refreshRun.runId), { recursive: true });
    // Without its run, the entry has no related run and must be left alone.
    await rm(resolve(runsDir, orphaned.runId), { recursive: true });
    for (const run of [orphaned, stale, refreshed, latest]) {
      expect(run.key).toBeDefined();
    }
    const staleKey = stale.key;
    const latestKey = latest.key;

    await writeFile(
      configPath,
      (await readFile(configPath, 'utf8')).replace(
        "branchPruneBaseRef: 'not-configured-yet'",
        "branchPruneBaseRef: 'main'",
      ),
    );
    const dryRun = await pruneBranch(['--dry-run']);
    expect(dryRun).toMatchObject({
      baseRef: 'main',
      baseRefSource: 'config',
      dryRun: true,
      keptLatestRunEntries: 1,
      keptBaseEntries: 1,
      keptUnreferencedEntries: 1,
      keptNewerThanLatestRunEntries: 1,
    });
    expect(
      dryRun.removed.map((entry) => ({
        namespace: entry.namespace,
        key: entry.key,
      })),
    ).toEqual([{ namespace: 'refund-workflow.plan-refund', key: staleKey }]);
    expect(await listCacheKeys()).toHaveLength(5);

    const pruned = await pruneBranch(['--base', 'main']);
    expect(pruned).toMatchObject({
      baseRef: 'main',
      baseRefSource: 'flag',
      dryRun: false,
    });
    expect(pruned.removed.map((entry) => entry.key)).toEqual([staleKey]);
    expect(await listCacheKeys()).toEqual(
      [baseKey, orphaned.key, refreshed.key, latestKey].sort(),
    );

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
