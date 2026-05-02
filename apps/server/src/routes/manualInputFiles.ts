import { stageManualInputFile } from '@ls-stack/agent-eval';
import { Hono } from 'hono';
import { getRunnerInstance } from '../runner.ts';

export const manualInputFilesRoutes = new Hono().post('/', async (c) => {
  const body = await c.req.parseBody();
  const uploaded: unknown = body['file'];
  if (!(uploaded instanceof File)) {
    return c.json({ error: 'Missing file upload' }, 400);
  }

  const runner = getRunnerInstance();
  const value = await stageManualInputFile({
    workspaceRoot: runner.getWorkspaceRoot(),
    bytes: new Uint8Array(await uploaded.arrayBuffer()),
    name: uploaded.name,
    mimeType: uploaded.type,
  });

  return c.json(value, 201);
});
