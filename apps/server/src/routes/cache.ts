import { Hono } from 'hono';
import { getRunnerInstance } from '../runner.ts';

/**
 * Cache management routes.
 *
 * - `GET /` lists persisted cache entries in the workspace.
 * - `GET /:namespace/:key` returns the full cache entry (including its
 *   recording / return value) for a single namespace+key pair.
 * - `DELETE /` clears the entire cache directory.
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
