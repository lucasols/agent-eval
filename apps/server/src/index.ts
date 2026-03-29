import { serve } from '@hono/node-server';
import { app } from './app.ts';

const port = Number(process.env.PORT) || 4100;

console.info(`Agent Evals server listening on http://localhost:${String(port)}`);

serve({ fetch: app.fetch, port });
