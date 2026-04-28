import { Hono } from 'hono';
import { detectWorkspacePackageManager } from '../packageManager.ts';
import { getRunnerInstance } from '../runner.ts';

export const workspaceRoutes = new Hono().get('/', async (c) => {
  const runner = getRunnerInstance();
  const packageManager = await detectWorkspacePackageManager(
    runner.getWorkspaceRoot(),
  );
  return c.json({ packageManager, llmCalls: runner.getLlmCallsConfig() }, 200);
});
