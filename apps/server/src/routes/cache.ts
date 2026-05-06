import { extractCacheEntries } from '@agent-evals/shared';
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
    const runner = getRunnerInstance();
    const entry = await runner.getCacheEntry(namespace, key);
    if (!entry) {
      return c.json({ error: 'cache entry not found' }, 404);
    }
    return c.json(entry, 200);
  })
  .delete('/', async (c) => {
    const runner = getRunnerInstance();
    await runner.clearCache();
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
        runner.clearCache({ namespace: entry.namespace, key: entry.key }),
      ),
    );

    return c.json({ ok: true, deletedEntries: entries.length }, 200);
  })
  .delete('/:namespace', async (c) => {
    const namespace = c.req.param('namespace');
    const runner = getRunnerInstance();
    await runner.clearCache({ namespace });
    return c.json({ ok: true }, 200);
  })
  .delete('/:namespace/:key', async (c) => {
    const namespace = c.req.param('namespace');
    const key = c.req.param('key');
    const runner = getRunnerInstance();
    await runner.clearCache({ namespace, key });
    return c.json({ ok: true }, 200);
  });

function getCacheEntriesForEvalRuns(
  runner: EvalRunner,
  evalKey: string,
): Array<{ namespace: string; key: string }> {
  const entries = new Map<string, { namespace: string; key: string }>();

  for (const manifest of runner.getRuns()) {
    const run = runner.getRun(manifest.id);
    if (run === undefined) continue;

    for (const caseRow of run.cases) {
      if (caseRow.evalKey !== evalKey) continue;
      const caseDetail = runner.getCaseDetail(manifest.id, caseRow.caseId);
      if (caseDetail === undefined) continue;

      for (const entry of extractCacheEntries(
        caseDetail.trace,
        caseDetail.cacheRefs,
      )) {
        if (!entry.stored) continue;
        entries.set(`${entry.namespace}\u0000${entry.key}`, {
          namespace: entry.namespace,
          key: entry.key,
        });
      }
    }
  }

  return [...entries.values()];
}
