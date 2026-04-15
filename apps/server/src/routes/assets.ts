import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { getRunnerInstance } from '../runner.ts';

export const assetsRoutes = new Hono()
  .get('/repo-file', async (c) => {
    const filePath = c.req.query('path');
    if (!filePath) {
      return c.json({ error: 'Missing path parameter' }, 400);
    }

    const runner = getRunnerInstance();
    const workspaceRoot = runner.getWorkspaceRoot();
    const resolved = resolve(workspaceRoot, filePath);
    const rel = relative(workspaceRoot, resolved);

    if (rel.startsWith('..') || resolve(rel) !== resolved) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }

    try {
      const content = await readFile(resolved);
      const mimeType = c.req.query('mimeType') ?? 'application/octet-stream';
      return c.body(content, 200, { 'Content-Type': mimeType });
    } catch {
      return c.json({ error: 'File not found' }, 404);
    }
  })
  .get('/artifacts/:artifactId', async (c) => {
    const artifactId = c.req.param('artifactId');
    const runner = getRunnerInstance();
    const artifactPath = runner.getArtifactPath(artifactId);

    if (!artifactPath) {
      return c.json({ error: 'Artifact not found' }, 404);
    }

    try {
      const content = await readFile(artifactPath);
      return c.body(content, 200);
    } catch {
      return c.json({ error: 'Artifact not found' }, 404);
    }
  });
