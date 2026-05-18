import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import {
  cacheDebugKeyEntrySchema,
  cacheEntrySchema,
  cacheListItemSchema,
  cacheRepairSummarySchema,
  type CacheDebugKeyEntry,
  type CacheEntry,
  type EvalTraceSpan,
} from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import {
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

const cacheListSchema = z.array(cacheListItemSchema);
const refundWorkflowPlanCacheFileRegex =
  /^refund-workflow\.plan-refund\/[a-f0-9]+\.json\.br$/;
const largeCacheKeyDiffCacheFileRegex =
  /^playground\.large-cache-key-diff-demo\/[a-f0-9]+\.json\.br$/;
const externalCacheBlobFileRegex =
  /^cache-blobs\/sha256\/[a-f0-9]{2}\/[a-f0-9]+\.json\.br$/;

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
  const cacheRoot = resolve(workspacePath, '.agent-evals/cache');
  if (!existsSync(cacheRoot)) return [];
  const collected: string[] = [];
  await collectFiles(cacheRoot, '.json.br', cacheRoot, collected);
  return collected.sort();
}

async function readCacheDebugDir(workspacePath: string): Promise<string[]> {
  const cacheDebugPath = resolve(workspacePath, '.agent-evals/cache-debug');
  if (!existsSync(cacheDebugPath)) return [];
  const collected: string[] = [];
  await collectFiles(cacheDebugPath, '.json', cacheDebugPath, collected);
  return collected.sort();
}

async function collectFiles(
  dir: string,
  extension: string,
  root: string,
  collected: string[],
): Promise<void> {
  const files = await readdir(dir);
  for (const file of files) {
    const filePath = resolve(dir, file);
    const info = await stat(filePath);
    if (info.isDirectory()) {
      await collectFiles(filePath, extension, root, collected);
      continue;
    }
    if (info.isFile() && file.endsWith(extension)) {
      collected.push(relative(root, filePath));
    }
  }
}

async function readCacheEntries(cacheFilePath: string): Promise<CacheEntry[]> {
  const compressed = await readFile(cacheFilePath);
  return [
    cacheEntrySchema.parse(
      JSON.parse(brotliDecompressSync(compressed).toString('utf8')),
    ),
  ];
}

async function readCacheDebugEntries(
  cacheDebugFilePath: string,
): Promise<CacheDebugKeyEntry[]> {
  return [
    cacheDebugKeyEntrySchema.parse(
      JSON.parse(await readFile(cacheDebugFilePath, 'utf8')),
    ),
  ];
}

async function readSingleCacheEntry(
  cacheFilePath: string,
): Promise<CacheEntry> {
  const [entry, extraEntry] = await readCacheEntries(cacheFilePath);
  if (entry === undefined || extraEntry !== undefined) {
    throw new Error('Expected exactly one cache entry');
  }
  return entry;
}

async function readSingleDebugEntry(
  cacheDebugFilePath: string,
): Promise<CacheDebugKeyEntry> {
  const [entry, extraEntry] = await readCacheDebugEntries(cacheDebugFilePath);
  if (entry === undefined || extraEntry !== undefined) {
    throw new Error('Expected exactly one debug entry');
  }
  return entry;
}

function cachePath(workspacePath: string, entryPath: string): string {
  return resolve(workspacePath, '.agent-evals/cache', entryPath);
}

function debugPath(workspacePath: string, entryPath: string): string {
  return resolve(workspacePath, '.agent-evals/cache-debug', entryPath);
}

function findLlmSpan(spans: EvalTraceSpan[], name: string): EvalTraceSpan {
  const match = spans.find((span) => span.name === name);
  if (match === undefined) {
    throw new Error(`Expected span ${name} in trace`);
  }
  return match;
}

function findSpan(spans: EvalTraceSpan[], name: string): EvalTraceSpan {
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
      expect(cacheFilesAfterFirst[0]).toMatch(refundWorkflowPlanCacheFileRegex);
      const cacheFilePath = cachePath(
        workspacePath,
        requireDefined(cacheFilesAfterFirst[0], 'first cache file'),
      );
      const cacheEntry = await readSingleCacheEntry(cacheFilePath);
      expect(cacheEntry.namespace).toBe('refund-workflow.plan-refund');
      expect(cacheEntry.recording.finalAttributes.model).toBe('gpt-4o-mini');
      expect(cacheEntry).not.toHaveProperty('debugKey');
      expect(JSON.stringify(cacheEntry)).not.toContain('"rawKey"');

      const debugFilesAfterFirst = await readCacheDebugDir(workspacePath);
      expect(debugFilesAfterFirst).toEqual([
        `refund-workflow.plan-refund/${cacheEntry.key}.json`,
      ]);
      const debugFilePath = debugPath(
        workspacePath,
        requireDefined(debugFilesAfterFirst[0], 'first debug cache file'),
      );
      const debugEntry = await readSingleDebugEntry(debugFilePath);
      expect(debugEntry).toMatchObject({
        key: cacheEntry.key,
        namespace: 'refund-workflow.plan-refund',
        operationType: 'span',
        operationName: 'plan-refund',
        rawKey: { prompt: 'I want a refund for order #123', locale: 'en-US' },
        entry: cacheEntry,
      });

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
      const secondEntry = await readSingleCacheEntry(cacheFilePath);
      expect(secondEntry.storedAt).toBe(firstStoredAt);
      const secondDebugEntry = await readSingleDebugEntry(debugFilePath);
      expect(secondDebugEntry.storedAt).toBe(firstStoredAt);
    });
  }, 10_000);

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
      const cacheFilePath = cachePath(
        workspacePath,
        requireDefined(cacheBefore[0], 'primed cache file'),
      );
      const beforeContents = await readFile(cacheFilePath);

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
      const afterContents = await readFile(cacheFilePath);
      expect(afterContents.equals(beforeContents)).toBe(true);
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
      const cacheFilePath = cachePath(
        workspacePath,
        requireDefined(cacheFiles[0], 'primed cache file'),
      );
      const originalEntry = await readSingleCacheEntry(cacheFilePath);

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

      const refreshed = await readSingleCacheEntry(cacheFilePath);
      expect(refreshed.storedAt).not.toBe(originalEntry.storedAt);
      expect(refreshed.key).toBe(originalEntry.key);
    });
  });

  test('eval cache read/store controls can read hits, skip stores, and write without reads', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const evalPath = resolve(workspacePath, 'evals/refund-workflow.eval.ts');
      const evalSource = await readFile(evalPath, 'utf8');

      const primed = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(primed.exitCode).toBe(0);

      const cacheFiles = await readCacheDir(workspacePath);
      const cacheFilePath = cachePath(
        workspacePath,
        requireDefined(cacheFiles[0], 'primed cache file'),
      );
      const primedEntry = await readSingleCacheEntry(cacheFilePath);

      await writeFile(
        evalPath,
        evalSource.replace(
          "title: 'Refund Workflow',",
          "title: 'Refund Workflow',\n  cache: { read: true, store: false },",
        ),
      );
      await resetRunsDirectory(workspacePath);

      const readOnlyHit = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(readOnlyHit.exitCode).toBe(0);

      const hitArtifacts = await readSingleRunArtifacts(workspacePath);
      const hitSpan = findLlmSpan(
        hitArtifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(getCacheStatus(hitSpan)).toBe('hit');
      expect(await readSingleCacheEntry(cacheFilePath)).toMatchObject({
        key: primedEntry.key,
        storedAt: primedEntry.storedAt,
      });

      await rm(resolve(workspacePath, '.agent-evals/cache'), {
        recursive: true,
        force: true,
      });
      await rm(resolve(workspacePath, '.agent-evals/cache-debug'), {
        recursive: true,
        force: true,
      });
      await resetRunsDirectory(workspacePath);

      const readOnlyMiss = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(readOnlyMiss.exitCode).toBe(0);

      const missArtifacts = await readSingleRunArtifacts(workspacePath);
      const missSpan = findLlmSpan(
        missArtifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(missSpan.attributes).toMatchObject({
        'cache.status': 'miss',
        'cache.stored': false,
      });
      expect(await readCacheDir(workspacePath)).toEqual([]);
      expect(await readCacheDebugDir(workspacePath)).toEqual([]);

      await writeFile(
        evalPath,
        evalSource.replace(
          "title: 'Refund Workflow',",
          "title: 'Refund Workflow',\n  cache: { read: false, store: true },",
        ),
      );
      await resetRunsDirectory(workspacePath);

      const writeOnlyFirst = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(writeOnlyFirst.exitCode).toBe(0);

      const writeOnlyFirstArtifacts =
        await readSingleRunArtifacts(workspacePath);
      const writeOnlyFirstSpan = findLlmSpan(
        writeOnlyFirstArtifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(writeOnlyFirstSpan.attributes).toMatchObject({
        'cache.status': 'miss',
        'cache.read': false,
      });
      const writeOnlyFiles = await readCacheDir(workspacePath);
      expect(writeOnlyFiles).toHaveLength(1);
      expect(writeOnlyFiles[0]).toMatch(refundWorkflowPlanCacheFileRegex);
      const writeOnlyCachePath = cachePath(
        workspacePath,
        requireDefined(writeOnlyFiles[0], 'write-only cache file'),
      );
      const writeOnlyFirstEntry =
        await readSingleCacheEntry(writeOnlyCachePath);

      await resetRunsDirectory(workspacePath);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));

      const writeOnlySecond = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(writeOnlySecond.exitCode).toBe(0);

      const writeOnlySecondArtifacts =
        await readSingleRunArtifacts(workspacePath);
      const writeOnlySecondSpan = findLlmSpan(
        writeOnlySecondArtifacts.traces['simple-text.json'] ?? [],
        'plan-refund',
      );
      expect(writeOnlySecondSpan.attributes).toMatchObject({
        'cache.status': 'miss',
        'cache.read': false,
      });
      const writeOnlySecondEntry =
        await readSingleCacheEntry(writeOnlyCachePath);
      expect(writeOnlySecondEntry.key).toBe(writeOnlyFirstEntry.key);
      expect(writeOnlySecondEntry.storedAt).not.toBe(
        writeOnlyFirstEntry.storedAt,
      );
    });
  }, 15_000);

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
      expect(first.namespace).toBe('refund-workflow.plan-refund');
      expect(first.lastAccessedAt).toBeNull();

      const listText = await runExampleCli(workspacePath, ['cache', 'list']);
      expect(listText.exitCode).toBe(0);
      expect(listText.stdout).toContain('last accessed: never');

      const clearResult = await runExampleCli(workspacePath, [
        'cache',
        'clear',
        '--all',
      ]);
      expect(clearResult.exitCode).toBe(0);
      expect(clearResult.stdout).toContain('Cleared all cache entries');

      const afterCache = await readCacheDir(workspacePath);
      expect(afterCache).toEqual([]);
      const afterDebugCache = await readCacheDebugDir(workspacePath);
      expect(afterDebugCache).toEqual([]);

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

  test('cache list shows indexed value cache entries', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const primed = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'receipt-audit',
        '--case',
        'damaged-mug',
      ]);
      expect(primed.exitCode).toBe(0);

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const damagedMug = requireDefined(
        artifacts.cases.find((caseRow) => caseRow.caseId === 'damaged-mug'),
        'damaged mug case row',
      );
      expect(damagedMug.columns).toMatchObject({
        auditEvents: [
          { step: 'context-built', orderId: '#A-18' },
          { step: 'claim-compared', discrepancyCount: 0 },
        ],
        auditMetadata: {
          auditStatus: 'verified',
          claimType: 'damage',
          discrepancyCount: 0,
          orderId: '#A-18',
        },
      });
      const trace = requireDefined(
        artifacts.traces['damaged-mug.json'],
        'damaged mug trace',
      );
      expect(findSpan(trace, 'receipt-audit').attributes).toMatchObject({
        auditSummary: {
          claimType: 'damage',
          expectedTotalUsd: 24.5,
          orderId: '#A-18',
        },
        auditEvents: ['context-built'],
      });
      expect(
        findSpan(trace, 'compare-claim-against-receipt').attributes,
      ).toMatchObject({ reviewedReceipts: 1 });

      const listJson = await runExampleCli(workspacePath, [
        'cache',
        'list',
        '--json',
      ]);
      expect(listJson.exitCode).toBe(0);
      const listedRaw: unknown = JSON.parse(listJson.stdout);
      const listed = cacheListSchema.parse(listedRaw);
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            namespace: 'receipt-audit.receipt-audit-context',
          }),
        ]),
      );
      expect(
        listed.find(
          (entry) => entry.namespace === 'receipt-audit.receipt-audit-context',
        ),
      ).toBeDefined();

      const listText = await runExampleCli(workspacePath, ['cache', 'list']);
      expect(listText.exitCode).toBe(0);
      expect(listText.stdout).toContain('receipt-audit.receipt-audit-context');
    });
  });

  test('cache repair reports and removes unindexed cache artifacts', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const primed = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(primed.exitCode).toBe(0);

      const namespaceDir = resolve(
        workspacePath,
        '.agent-evals/cache/refund-workflow.plan-refund',
      );
      await writeFile(resolve(namespaceDir, 'legacy.json.br'), 'legacy');
      const debugDir = resolve(
        workspacePath,
        '.agent-evals/cache-debug/refund-workflow.plan-refund',
      );
      await mkdir(debugDir, { recursive: true });
      await writeFile(resolve(debugDir, 'legacy.json'), '{}');
      const blobDir = resolve(
        workspacePath,
        '.agent-evals/cache/cache-blobs/sha256/aa',
      );
      await mkdir(blobDir, { recursive: true });
      await writeFile(resolve(blobDir, 'aa-orphan.json.br'), 'orphan');

      const repairText = await runExampleCli(workspacePath, [
        'cache',
        'repair',
      ]);
      expect(repairText.exitCode).toBe(0);
      expect(repairText.stdout).toContain('Cache repair complete.');
      expect(repairText.stdout).toContain('Removed cache files: 1');
      expect(repairText.stdout).toContain('Removed debug files: 1');
      expect(repairText.stdout).toContain('Removed blob files: 1');

      const repairJson = await runExampleCli(workspacePath, [
        'cache',
        'repair',
        '--json',
      ]);
      expect(repairJson.exitCode).toBe(0);
      const summaryRaw: unknown = JSON.parse(repairJson.stdout);
      expect(cacheRepairSummarySchema.parse(summaryRaw)).toEqual({
        removedCacheFiles: 0,
        removedDebugFiles: 0,
        removedBlobFiles: 0,
        removedIndexRows: 0,
        rewrittenIndexes: 0,
      });
    });
  });

  test('large cached return payloads store blobs inside the cache directory', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const run = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'large-cache-key-diff-demo',
      ]);
      expect(run.exitCode).toBe(0);

      const cacheFiles = await readCacheDir(workspacePath);
      expect(cacheFiles).toEqual(
        expect.arrayContaining([
          expect.stringMatching(largeCacheKeyDiffCacheFileRegex),
          expect.stringMatching(externalCacheBlobFileRegex),
        ]),
      );

      const listJson = await runExampleCli(workspacePath, [
        'cache',
        'list',
        '--json',
      ]);
      expect(listJson.exitCode).toBe(0);
      const listedRaw: unknown = JSON.parse(listJson.stdout);
      const listed = cacheListSchema.parse(listedRaw);
      expect(listed).toEqual([
        expect.objectContaining({
          namespace: 'playground.large-cache-key-diff-demo',
        }),
      ]);
    });
  });

  test('cache keys reuse entries when only the eval source fingerprint changes', async () => {
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
      const cacheFilePath = cachePath(
        workspacePath,
        requireDefined(cacheBefore[0], 'cache file before source edit'),
      );
      const [cacheEntryBefore, extraEntryBefore] =
        await readCacheEntries(cacheFilePath);
      if (cacheEntryBefore === undefined || extraEntryBefore !== undefined) {
        throw new Error('Expected exactly one cache entry before source edit');
      }

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
      // edit a comment-only line so behaviour is identical but the source
      // fingerprint shifts.
      const source = await readFile(evalInWorkspace, 'utf8');
      await writeFile(
        evalInWorkspace,
        `// cache-preserving comment ${String(Date.now())}\n${source}`,
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
      expect(getCacheStatus(planSpan)).toBe('hit');
      expect(planSpan.attributes?.['cache.key']).toBe(cacheEntryBefore.key);

      const cacheAfter = await readCacheDir(workspacePath);
      expect(cacheAfter).toEqual(cacheBefore);
      const entries = await readCacheEntries(cacheFilePath);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.storedAt).toBe(cacheEntryBefore.storedAt);
    });
  });

  test('one-off CLI runs leave retention pruning to a persistent idle runner', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const configPath = resolve(workspacePath, 'agent-evals.config.ts');
      const configSource = await readFile(configPath, 'utf8');
      await writeFile(
        configPath,
        configSource.replace(
          '\n};\n',
          '\n  cache: { maxEntriesPerNamespace: 2 },\n};\n',
        ),
      );

      const run = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
      ]);
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe('');

      const cacheFiles = await readCacheDir(workspacePath);
      expect(cacheFiles).toHaveLength(3);
      expect(cacheFiles).toEqual(
        expect.arrayContaining([
          expect.stringMatching(refundWorkflowPlanCacheFileRegex),
        ]),
      );
      const entries = await Promise.all(
        cacheFiles.map((file) =>
          readSingleCacheEntry(cachePath(workspacePath, file)),
        ),
      );
      expect(entries).toHaveLength(3);
      expect(
        entries.every(
          (entry) => entry.namespace === 'refund-workflow.plan-refund',
        ),
      ).toBe(true);
    });
  });

  test('one-off CLI runs also defer namespace-specific retention', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const configPath = resolve(workspacePath, 'agent-evals.config.ts');
      const configSource = await readFile(configPath, 'utf8');
      await writeFile(
        configPath,
        configSource.replace(
          '\n};\n',
          "\n  cache: { maxEntriesByNamespace: { 'receipt-audit.receipt-audit-context': 1 } },\n};\n",
        ),
      );

      const run = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'receipt-audit',
      ]);
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe('');

      const cacheFiles = await readCacheDir(workspacePath);
      const entries = await Promise.all(
        cacheFiles.map((file) =>
          readSingleCacheEntry(cachePath(workspacePath, file)),
        ),
      );
      const contextEntries = entries.filter(
        (entry) => entry.namespace === 'receipt-audit.receipt-audit-context',
      );
      expect(contextEntries.length).toBeGreaterThan(1);
    });
  });
});
