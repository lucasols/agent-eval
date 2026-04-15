import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { initRunner } from './runner.ts';

const port = Number(process.env.PORT) || 4100;

await initRunner();

console.info(`Agent Evals server listening on http://localhost:${String(port)}`);

serve({ fetch: app.fetch, port });
