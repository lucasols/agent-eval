import { existsSync } from 'node:fs';
import { resolve as resolvePath, sep } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import launch from 'launch-editor';
import { getRunnerInstance } from '../runner.ts';

export const evalsRoutes = new Hono()
  .get('/', (c) => {
    const runner = getRunnerInstance();
    const evals = runner.getEvals();
    return c.json(evals, 200);
  })
  .post('/refresh', async (c) => {
    const runner = getRunnerInstance();
    await runner.refreshDiscovery();
    const evals = runner.getEvals();
    return c.json(evals, 200);
  })
  .get('/events', (c) => {
    const runner = getRunnerInstance();

    return streamSSE(c, async (stream) => {
      const cleanup = runner.subscribeDiscovery((event) => {
        void stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      });

      stream.onAbort(() => {
        cleanup();
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          resolve();
        });
      });
    });
  })
  .get('/:evalId', (c) => {
    const runner = getRunnerInstance();
    const evalId = c.req.param('evalId');
    const evalData = runner.getEval(evalId);
    if (!evalData) {
      return c.json({ error: 'Eval not found' }, 404);
    }
    return c.json(evalData, 200);
  })
  .post('/:evalId/open-in-editor', (c) => {
    const runner = getRunnerInstance();
    const evalId = c.req.param('evalId');
    const evalData = runner.getEval(evalId);
    if (!evalData) {
      return c.json({ error: 'Eval not found' }, 404);
    }
    const workspaceRoot = runner.getWorkspaceRoot();
    const absolutePath = resolvePath(workspaceRoot, evalData.filePath);
    if (!absolutePath.startsWith(workspaceRoot + sep)) {
      return c.json({ error: 'Resolved path escapes workspace' }, 400);
    }
    if (!existsSync(absolutePath)) {
      return c.json({ error: 'Source file not found on disk' }, 404);
    }
    launch(absolutePath, (_fileName, errorMessage) => {
      if (errorMessage) {
        console.error(
          `[open-in-editor] failed for ${absolutePath}: ${errorMessage}`,
        );
      }
    });
    return c.json({ ok: true }, 200);
  });
