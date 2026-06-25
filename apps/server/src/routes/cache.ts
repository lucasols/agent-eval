import {
  extractCacheEntries,
  type CacheStorage,
  type CaseDetail,
  type RunManifest,
} from '@agent-evals/shared';
import type { EvalRunner } from '@ls-stack/agent-eval';
import { Hono } from 'hono';
import { getRunnerInstance } from '../runner.ts';

/**
 * Cache management routes.
 *
 * - `GET /` lists persisted cache entries in the workspace.
 * - `GET /:namespace/:key` returns the full cache entry (including its
 *   recording / return value) for a single namespace+key pair.
 * - `DELETE /` clears the entire cache directory.
 * - `DELETE /actions/eval?evalKey=<key>` clears entries recorded by saved runs
 *   for one exact eval identity.
 * - `DELETE /actions/run-history/:runId` clears entries recorded by the run
 *   and all earlier saved runs.
 * - `DELETE /:namespace` clears one namespace.
 * - `DELETE /:namespace/:key` clears a single entry by its key hash.
 */
export const cacheRoutes = new Hono()
  .get('/', async (c) => {
    const runner = getRunnerInstance();
    const entries = await runner.listCache();
    return c.json(entries, 200);
  })
  .get('/:namespace/:key', async (c) => {
    const namespace = c.req.param('namespace');
    const key = c.req.param('key');
    const storage = parseCacheStorage(c.req.query('storage'));
    const runner = getRunnerInstance();
    const entry = await runner.getCacheEntry(namespace, key, storage);
    if (!entry) {
      return c.json({ error: 'cache entry not found' }, 404);
    }
    return c.json(entry, 200);
  })
  .delete('/', async (c) => {
    const runner = getRunnerInstance();
    await runner.clearCache({
      reason: 'web/API cache clear requested for all entries',
    });
    return c.json({ ok: true }, 200);
  })
  .delete('/actions/eval', async (c) => {
    const evalKey = c.req.query('evalKey');
    if (evalKey === undefined || evalKey.length === 0) {
      return c.json({ error: 'evalKey query param is required' }, 400);
    }

    const runner = getRunnerInstance();
    const entries = getCacheEntriesForEvalRuns(runner, evalKey);

    await Promise.all(
      entries.map((entry) =>
        runner.clearCache({
          namespace: entry.namespace,
          key: entry.key,
          ...(entry.storage === undefined ? {} : { storage: entry.storage }),
          reason: `web/API cache clear requested for eval ${evalKey}`,
        }),
      ),
    );

    return c.json({ ok: true, deletedEntries: entries.length }, 200);
  })
  .delete('/actions/run-history/:runId', async (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();
    const entries = getCacheEntriesForRunAndPrevious(runner, runId);
    if (entries === null) {
      return c.json({ error: 'Run not found' }, 404);
    }

    await Promise.all(
      entries.map((entry) =>
        runner.clearCache({
          namespace: entry.namespace,
          key: entry.key,
          ...(entry.storage === undefined ? {} : { storage: entry.storage }),
          reason: `web/API cache clear requested for run history through ${runId}`,
        }),
      ),
    );

    return c.json({ ok: true, deletedEntries: entries.length, entries }, 200);
  })
  .delete('/:namespace', async (c) => {
    const namespace = c.req.param('namespace');
    const runner = getRunnerInstance();
    await runner.clearCache({
      namespace,
      reason: `web/API cache clear requested for namespace ${namespace}`,
    });
    return c.json({ ok: true }, 200);
  })
  .delete('/:namespace/:key', async (c) => {
    const namespace = c.req.param('namespace');
    const key = c.req.param('key');
    const storage = parseCacheStorage(c.req.query('storage'));
    const runner = getRunnerInstance();
    await runner.clearCache({
      namespace,
      key,
      ...(storage === undefined ? {} : { storage }),
      reason: `web/API cache clear requested for namespace ${namespace} and key ${key}`,
    });
    return c.json({ ok: true }, 200);
  });

function getCacheEntriesForEvalRuns(
  runner: EvalRunner,
  evalKey: string,
): Array<{ namespace: string; key: string; storage?: CacheStorage }> {
  const entries = new Map<
    string,
    { namespace: string; key: string; storage?: CacheStorage }
  >();

  for (const manifest of runner.getRuns()) {
    const run = runner.getRun(manifest.id);
    if (run === undefined) continue;

    for (const caseRow of run.cases) {
      if (caseRow.evalKey !== evalKey) continue;
      const caseDetail = runner.getCaseDetail(manifest.id, caseRow.caseId);
      if (caseDetail === undefined) continue;

      for (const entry of getStoredCacheEntriesForCase(caseDetail)) {
        entries.set(
          `${entry.namespace}\u0000${entry.key}\u0000${entry.storage ?? ''}`,
          {
            namespace: entry.namespace,
            key: entry.key,
            ...(entry.storage === undefined ? {} : { storage: entry.storage }),
          },
        );
      }
    }
  }

  return [...entries.values()];
}

function getCacheEntriesForRunAndPrevious(
  runner: EvalRunner,
  runId: string,
): Array<{ namespace: string; key: string; storage?: CacheStorage }> | null {
  const selectedRun = runner.getRun(runId);
  if (selectedRun === undefined) return null;

  const entries = new Map<
    string,
    { namespace: string; key: string; storage?: CacheStorage }
  >();

  for (const manifest of runner.getRuns()) {
    const run = runner.getRun(manifest.id);
    if (run === undefined) continue;
    if (!runIsSelectedOrPrevious(run.manifest, selectedRun.manifest)) {
      continue;
    }

    for (const caseRow of run.cases) {
      const caseDetail = runner.getCaseDetail(manifest.id, caseRow.caseId);
      if (caseDetail === undefined) continue;

      for (const entry of getStoredCacheEntriesForCase(caseDetail)) {
        entries.set(
          `${entry.namespace}\u0000${entry.key}\u0000${entry.storage ?? ''}`,
          {
            namespace: entry.namespace,
            key: entry.key,
            ...(entry.storage === undefined ? {} : { storage: entry.storage }),
          },
        );
      }
    }
  }

  return [...entries.values()];
}

function getStoredCacheEntriesForCase(caseDetail: CaseDetail) {
  const entries = extractCacheEntries(caseDetail.trace, caseDetail.cacheRefs);

  for (const scoreTrace of Object.values(caseDetail.scoringTraces ?? {})) {
    entries.push(
      ...extractCacheEntries(scoreTrace.trace, scoreTrace.cacheRefs),
    );
  }

  return entries.filter((entry) => entry.stored);
}

function runIsSelectedOrPrevious(
  manifest: RunManifest,
  selectedManifest: RunManifest,
): boolean {
  if (manifest.id === selectedManifest.id) return true;

  const runSequence = readRunSequence(manifest.shortId);
  const selectedSequence = readRunSequence(selectedManifest.shortId);
  if (runSequence !== undefined && selectedSequence !== undefined) {
    return runSequence <= selectedSequence;
  }

  const runStartedAt = Date.parse(manifest.startedAt);
  const selectedStartedAt = Date.parse(selectedManifest.startedAt);
  if (!Number.isFinite(runStartedAt) || !Number.isFinite(selectedStartedAt)) {
    return false;
  }

  return runStartedAt <= selectedStartedAt;
}

function readRunSequence(shortId: string): number | undefined {
  if (!shortId.startsWith('r')) return undefined;
  const value = Number(shortId.slice(1));
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseCacheStorage(
  value: string | undefined,
): CacheStorage | undefined {
  if (value === 'durable' || value === 'temporary') return value;
  return undefined;
}
