import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cacheListItemSchema, runSummarySchema } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  runExampleCli,
  runWorkspaceCommand,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

test('completed runs prune only superseded branch cache for the cases that ran', async () => {
  await withIsolatedExampleWorkspace(async (workspacePath) => {
    const configPath = resolve(workspacePath, 'agent-evals.config.ts');
    const originalConfig = await readFile(configPath, 'utf8');
    const setBase = (base: string) =>
      writeFile(
        configPath,
        originalConfig.replace(
          "branchPruneBaseRef: 'origin/main'",
          `branchPruneBaseRef: '${base}'`,
        ),
      );
    // Build older history without a resolvable base, as when working before
    // fetching the base branch. Automatic cleanup must leave these runs valid.
    await setBase('unavailable');
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
    const run = async (
      evalId: string,
      caseId: string,
      extraArgs: string[] = [],
    ) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        evalId,
        '--case',
        caseId,
        '--json',
        ...extraArgs,
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      return result;
    };
    const list = async () => {
      const result = await runExampleCli(workspacePath, [
        'cache',
        'list',
        '--json',
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      return cacheListItemSchema.array().parse(JSON.parse(result.stdout));
    };
    const keys = async () => (await list()).map((entry) => entry.key).sort();
    const evalPath = resolve(workspacePath, 'evals/refund-workflow.eval.ts');
    const source = await readFile(evalPath, 'utf8');
    const editMessage = (message: string) =>
      writeFile(
        evalPath,
        source.replace('I want a refund for order #123', message),
      );
    const runRefund = () => run('refund-workflow', 'simple-text');

    await runRefund();
    const baseKeys = await keys();
    expect(baseKeys).toHaveLength(1);
    await writeFile(
      resolve(workspacePath, '.gitignore'),
      'node_modules\n.agent-evals/*\n!.agent-evals/cache/\n',
    );
    await git(['init', '--quiet', '--initial-branch', 'main']);
    await git(['add', '.']);
    await git(['commit', '--quiet', '-m', 'base cache']);
    await git(['checkout', '--quiet', '-b', 'feature']);

    await editMessage('I want a refund for order #456');
    await runRefund();
    const sharedKeys = (await keys()).filter((key) => !baseKeys.includes(key));
    expect(sharedKeys).toHaveLength(1);
    // A second case used the same plan, then moved on. Its entire history
    // must remain untouched when only simple-text runs again.
    await writeFile(
      evalPath,
      source.replace(
        "message: 'Please refund this damaged item',",
        "message: 'I want a refund for order #456', locale: 'en-US',",
      ),
    );
    await run('refund-workflow', 'with-image');
    await editMessage('I want a refund for order #789');
    await run('refund-workflow', 'with-image');
    const untouchedCaseKeys = await keys();
    await runRefund();
    const staleKeys = (await keys()).filter(
      (key) => !untouchedCaseKeys.includes(key),
    );
    expect(staleKeys).toHaveLength(1);
    // Branch-committed entries are eligible too, not just untracked writes.
    await git(['add', '.agent-evals/cache']);
    await git(['commit', '--quiet', '-m', 'branch cache']);

    const galleryPath = resolve(
      workspacePath,
      'evals/support/playground/format-gallery.eval.ts',
    );
    const gallerySource = await readFile(galleryPath, 'utf8');
    await run('format-gallery', 'all-column-formats');
    await writeFile(
      galleryPath,
      gallerySource.replaceAll('damaged mug', 'chipped cup'),
    );
    await run('format-gallery', 'all-column-formats');
    const otherEvalEntries = (await list()).filter(
      (entry) => entry.namespace === 'format-gallery.auto-quality-review',
    );
    expect(otherEvalEntries).toHaveLength(2);

    await setBase('main');
    await editMessage('I want a refund for order #999');
    const completed = await runRefund();
    expect(completed.stderr).toContain('branch cache prune:');
    const afterPrune = await keys();
    expect(afterPrune).toEqual(expect.arrayContaining(untouchedCaseKeys));
    expect(afterPrune).not.toEqual(expect.arrayContaining(staleKeys));
    expect(
      (await list()).filter(
        (entry) => entry.namespace === 'format-gallery.auto-quality-review',
      ),
    ).toEqual(otherEvalEntries);
    const currentKeys = afterPrune.filter(
      (key) =>
        !untouchedCaseKeys.includes(key) &&
        !otherEvalEntries.some((entry) => entry.key === key),
    );
    expect(currentKeys).toHaveLength(1);

    const cached = await runRefund();
    const completedSummary = runSummarySchema.parse(
      JSON.parse(completed.stdout),
    );
    const cachedSummary = runSummarySchema.parse(JSON.parse(cached.stdout));
    expect(cachedSummary.cacheHits).toBe(1);
    expect(await keys()).toEqual(afterPrune);
    expect(
      normalizeSnapshotValue(workspacePath, {
        completed: completedSummary,
        cached: cachedSummary,
      }),
    ).toMatchInlineSnapshot(`
      {
        "cached": {
          "cacheHits": 1,
          "cacheOperations": 1,
          "cancelledCases": 0,
          "errorCases": 0,
          "errorMessage": null,
          "failedCases": 0,
          "llmCacheHits": 1,
          "llmCalls": 1,
          "llmCallsMade": 0,
          "passedCases": 1,
          "runId": "<run-id>",
          "status": "completed",
          "totalCases": 1,
          "totalDurationMs": "<totalDurationMs>",
        },
        "completed": {
          "cacheHits": 0,
          "cacheOperations": 1,
          "cancelledCases": 0,
          "errorCases": 0,
          "errorMessage": null,
          "failedCases": 0,
          "llmCacheHits": 0,
          "llmCalls": 1,
          "llmCallsMade": 1,
          "passedCases": 1,
          "runId": "<run-id>",
          "status": "completed",
          "totalCases": 1,
          "totalDurationMs": "<totalDurationMs>",
        },
      }
    `);

    await editMessage('I want a refund for order #1000');
    await run('refund-workflow', 'simple-text', ['--cache', 'bypass']);
    expect(await keys()).toEqual(afterPrune);

    // Runtime errors must not supersede the last completed case's cache.
    const workflowPath = resolve(
      workspacePath,
      'src/evals/refundWorkflowSharedConfig.ts',
    );
    await writeFile(
      workflowPath,
      (await readFile(workflowPath, 'utf8')).replace(
        'await triggerWorkflow(input);',
        "await triggerWorkflow(input); throw new Error('Refund service unavailable');",
      ),
    );
    const errored = await runExampleCli(workspacePath, [
      'run',
      '--eval',
      'refund-workflow',
      '--case',
      'simple-text',
      '--json',
    ]);
    expect(errored.exitCode).toBe(1);
    expect(runSummarySchema.parse(JSON.parse(errored.stdout)).errorCases).toBe(
      1,
    );
    expect(await keys()).toEqual(expect.arrayContaining(afterPrune));
  });
}, 90_000);
