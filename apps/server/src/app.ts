import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { evalsRoutes } from './routes/evals.ts';
import { runsRoutes } from './routes/runs.ts';
import { assetsRoutes } from './routes/assets.ts';

const baseApp = new Hono();

baseApp.use('/*', cors());

// routes must be chained in order for hono rpc to work
const routes_ = baseApp
  .route('/api/evals', evalsRoutes)
  .route('/api/runs', runsRoutes)
  .route('/api', assetsRoutes);

export type AppType = typeof routes_;

const serverDir = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(serverDir, '../../web/dist');
const webDistExists = existsSync(webDist);

if (webDistExists) {
  baseApp.use('/*', serveStatic({ root: webDist }));
  baseApp.get('/*', serveStatic({ root: webDist, path: 'index.html' }));
} else {
  baseApp.get('/*', (c) =>
    c.text(
      `Web UI not built. Run "pnpm --filter @agent-evals/web build" first.\nExpected: ${webDist}`,
      503,
    ),
  );
}

export const app = baseApp;
