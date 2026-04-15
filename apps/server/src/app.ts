import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { evalsRoutes } from './routes/evals.ts';
import { runsRoutes } from './routes/runs.ts';
import { assetsRoutes } from './routes/assets.ts';

export const app = new Hono();

app.use('/*', cors());

app.route('/api/evals', evalsRoutes);
app.route('/api/runs', runsRoutes);
app.route('/api', assetsRoutes);

const serverDir = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(serverDir, '../../web/dist');
const webDistExists = existsSync(webDist);

if (webDistExists) {
  app.use('/*', serveStatic({ root: webDist }));
  app.get('/*', serveStatic({ root: webDist, path: 'index.html' }));
} else {
  app.get('/*', (c) =>
    c.text(
      `Web UI not built. Run "pnpm --filter @agent-evals/web build" first.\nExpected: ${webDist}`,
      503,
    ),
  );
}
