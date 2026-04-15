import { Hono } from 'hono';
import { getRunnerInstance } from '../runner.ts';

export const evalsRoutes = new Hono();

evalsRoutes.get('/', (c) => {
  const runner = getRunnerInstance();
  const evals = runner.getEvals();
  return c.json(evals, 200);
});

evalsRoutes.post('/refresh', async (c) => {
  const runner = getRunnerInstance();
  await runner.refreshDiscovery();
  const evals = runner.getEvals();
  return c.json(evals, 200);
});

evalsRoutes.get('/:evalId', (c) => {
  const runner = getRunnerInstance();
  const evalId = c.req.param('evalId');
  const evalData = runner.getEval(evalId);
  if (!evalData) {
    return c.json({ error: 'Eval not found' }, 404);
  }
  return c.json(evalData, 200);
});
