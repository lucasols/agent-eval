import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { evalsRoutes } from './routes/evals.ts';
import { runsRoutes } from './routes/runs.ts';
import { assetsRoutes } from './routes/assets.ts';

export const app = new Hono();

app.use('/*', cors());

app.route('/api/evals', evalsRoutes);
app.route('/api/runs', runsRoutes);
app.route('/api', assetsRoutes);

app.use('/*', serveStatic({ root: './public' }));
app.get('/*', serveStatic({ root: './public', path: 'index.html' }));
