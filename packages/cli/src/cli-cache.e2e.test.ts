import { existsSync } from 'node:fs';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  cacheEntrySchema,
  cacheListItemSchema,
  type EvalTraceSpan,
} from '@agent-evals/shared';
import { z } from 'zod/v4';
import {
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

const cacheListSchema = z.array(cacheListItemSchema);

function requireDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

async function resetRunsDirectory(workspacePath: string): Promise<void> {
  await rm(resolve(workspacePath, '.agent-evals/runs'), {
    force: true,
    recursive: true,
  });
}

async function readCacheDir(workspacePath: string): Promise<string[]> {
  const cachePath = resolve(workspacePath, '.agent-evals/cache');
  if (!existsSync(cachePath)) return [];
  const namespaces = await readdir(cachePath);
  const collected: string[] = [];
  for (const namespace of namespaces) {
    const nsPath = resolve(cachePath, namespace);
    const info = await stat(nsPath);
    if (!info.isDirectory()) continue;
    const files = await readdir(nsPath);
    for (const file of files) {
      collected.push(`${namespace}/${file}`);
    }
  }
  return collected.sort();
}

function findLlmSpan(spans: EvalTraceSpan[], name: string): EvalTraceSpan {
  const match = spans.find((span) => span.name === name);
  if (match === undefined) {
    throw new Error(`Expected span ${name} in trace`);
  }
  return match;
}

function getCacheStatus(span: EvalTraceSpan): unknown {
  return span.attributes?.['cache.status'];
}

describe('CLI operation caching', () => {
  test('writes cache entries on first run and reuses them on the second run', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const firstRun = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(firstRun.exitCode).toBe(0);
      expect(firstRun.stderr).toBe('');

      const firstArtifacts = await readSingleRunArtifacts(workspacePath);
      const firstCase = firstArtifacts.cases.find(
        (row) => row.caseId === 'simple-text',
      );
      if (firstCase === undefined) {
        throw new Error('Missing simple-text case on first run');
      }
      const firstPlanSpan = findLlmSpan(
        firstArtifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(getCacheStatus(firstPlanSpan)).toBe('miss');
      expect(firstPlanSpan.attributes?.['cache.key']).toEqual(
        expect.any(String),
      );
      expect(firstArtifacts.manifest.cacheMode).toBe('use');

      const cacheFilesAfterFirst = await readCacheDir(workspacePath);
      expect(cacheFilesAfterFirst).toHaveLength(1);
      const cacheFilePath = resolve(
        workspacePath,
        '.agent-evals/cache',
        requireDefined(cacheFilesAfterFirst[0], 'first cache file'),
      );
      const cacheEntry = cacheEntrySchema.parse(
        JSON.parse(await readFile(cacheFilePath, 'utf8')),
      );
      expect(cacheEntry.namespace).toBe('refund-workflow__plan-refund');
      expect(cacheEntry.recording.ops.length).toBeGreaterThan(0);

      const firstStoredAt = cacheEntry.storedAt;

      await resetRunsDirectory(workspacePath);

      const secondRun = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(secondRun.exitCode).toBe(0);

      const secondArtifacts = await readSingleRunArtifacts(workspacePath);
      const secondPlanSpan = findLlmSpan(
        secondArtifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(getCacheStatus(secondPlanSpan)).toBe('hit');
      expect(secondPlanSpan.attributes?.['cache.storedAt']).toBe(firstStoredAt);
      const secondCase = secondArtifacts.cases.find(
        (row) => row.caseId === 'simple-text',
      );
      if (secondCase === undefined) {
        throw new Error('Missing simple-text case on second run');
      }
      expect(secondCase.costUsd).toBe(firstCase.costUsd);
      expect(secondCase.status).toBe(firstCase.status);
      expect(secondCase.columns.response).toEqual(firstCase.columns.response);

      // cache file must still be a single untouched entry
      const cacheFilesAfterSecond = await readCacheDir(workspacePath);
      expect(cacheFilesAfterSecond).toEqual(cacheFilesAfterFirst);
      const secondEntry = cacheEntrySchema.parse(
        JSON.parse(await readFile(cacheFilePath, 'utf8')),
      );
      expect(secondEntry.storedAt).toBe(firstStoredAt);
    });
  });

  test('--no-cache bypasses the cache and leaves existing entries untouched', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      // prime the cache with one miss
      const primed = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(primed.exitCode).toBe(0);
      const cacheBefore = await readCacheDir(workspacePath);
      const cacheFilePath = resolve(
        workspacePath,
        '.agent-evals/cache',
        requireDefined(cacheBefore[0], 'primed cache file'),
      );
      const beforeContents = await readFile(cacheFilePath, 'utf8');

      await resetRunsDirectory(workspacePath);

      const bypass = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
        '--no-cache',
      ]);
      expect(bypass.exitCode).toBe(0);

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const planSpan = findLlmSpan(
        artifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(getCacheStatus(planSpan)).toBe('bypass');
      expect(artifacts.manifest.cacheMode).toBe('bypass');

      // cache file bytes must be unchanged by a bypass run
      const afterContents = await readFile(cacheFilePath, 'utf8');
      expect(afterContents).toBe(beforeContents);
    });
  });

  test('--refresh-cache rewrites the stored entry', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const primed = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(primed.exitCode).toBe(0);

      const cacheFiles = await readCacheDir(workspacePath);
      const cacheFilePath = resolve(
        workspacePath,
        '.agent-evals/cache',
        requireDefined(cacheFiles[0], 'primed cache file'),
      );
      const originalEntry = cacheEntrySchema.parse(
        JSON.parse(await readFile(cacheFilePath, 'utf8')),
      );

      await resetRunsDirectory(workspacePath);
      // wait a tick so `storedAt` differs
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));

      const refresh = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
        '--refresh-cache',
      ]);
      expect(refresh.exitCode).toBe(0);

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const planSpan = findLlmSpan(
        artifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(getCacheStatus(planSpan)).toBe('refresh');

      const refreshed = cacheEntrySchema.parse(
        JSON.parse(await readFile(cacheFilePath, 'utf8')),
      );
      expect(refreshed.storedAt).not.toBe(originalEntry.storedAt);
      expect(refreshed.key).toBe(originalEntry.key);
    });
  });

  test('cache list shows entries and cache clear removes them', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const primed = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(primed.exitCode).toBe(0);

      const listResult = await runExampleCli(workspacePath, [
        'cache',
        'list',
        '--json',
      ]);
      expect(listResult.exitCode).toBe(0);
      const listedRaw: unknown = JSON.parse(listResult.stdout);
      const listed = cacheListSchema.parse(listedRaw);
      expect(listed).toHaveLength(1);
      const first = requireDefined(listed[0], 'first listed entry');
      expect(first.namespace).toBe('refund-workflow__plan-refund');
      expect(first.spanName).toBe('plan-refund');
      expect(first.spanKind).toBe('llm');

      const clearResult = await runExampleCli(workspacePath, [
        'cache',
        'clear',
        '--all',
      ]);
      expect(clearResult.exitCode).toBe(0);
      expect(clearResult.stdout).toContain('Cleared all cache entries');

      const afterCache = await readCacheDir(workspacePath);
      expect(afterCache).toEqual([]);

      await resetRunsDirectory(workspacePath);
      const secondRun = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(secondRun.exitCode).toBe(0);
      const artifacts = await readSingleRunArtifacts(workspacePath);
      const planSpan = findLlmSpan(
        artifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(getCacheStatus(planSpan)).toBe('miss');
    });
  });

  test('code fingerprint invalidates cache when the eval source changes', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const primed = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(primed.exitCode).toBe(0);
      const cacheBefore = await readCacheDir(workspacePath);
      expect(cacheBefore).toHaveLength(1);

      const evalInWorkspace = resolve(
        workspacePath,
        'evals/refund-workflow.eval.ts',
      );
      if (!existsSync(evalInWorkspace)) {
        // withIsolatedExampleWorkspace clones examples/basic-agent, so this
        // file exists. If the fixture changes, guard against silent skips.
        throw new Error(
          `Expected eval file at ${evalInWorkspace}; fixture changed?`,
        );
      }
      // edit a comment-only line so behaviour is identical but the source hash shifts
      const source = await readFile(evalInWorkspace, 'utf8');
      await writeFile(
        evalInWorkspace,
        `// cache-invalidating comment ${String(Date.now())}\n${source}`,
      );

      await resetRunsDirectory(workspacePath);

      const secondRun = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(secondRun.exitCode).toBe(0);
      const artifacts = await readSingleRunArtifacts(workspacePath);
      const planSpan = findLlmSpan(
        artifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(getCacheStatus(planSpan)).toBe('miss');

      const cacheAfter = await readCacheDir(workspacePath);
      expect(cacheAfter).toHaveLength(2);
    });
  });
});
