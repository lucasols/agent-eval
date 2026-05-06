import { existsSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath, sep } from 'node:path';
import { zValidator } from '@hono/zod-validator';
import {
  createRunRequestSchema,
  updateManualScoreRequestSchema,
} from '@ls-stack/agent-eval';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import launch from 'launch-editor';
import { resultify } from 't-result';
import { z } from 'zod/v4';
import { getRunnerInstance } from '../runner.ts';

const openRunLocationRequestSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().min(1),
  column: z.number().int().min(1),
});
const importQuerySeparatorRegex = /[?#]/;

function isInsideWorkspace(path: string, workspaceRoot: string): boolean {
  return path === workspaceRoot || path.startsWith(workspaceRoot + sep);
}

function stripImportQuery(path: string): string {
  return path.split(importQuerySeparatorRegex, 1)[0] ?? path;
}

function formatUnknownErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export const runsRoutes = new Hono()
  .get('/', (c) => {
    const runner = getRunnerInstance();
    const runs = runner.getRuns();
    return c.json(runs, 200);
  })
  .post('/actions/recompute-status/:evalId', async (c) => {
    const evalId = c.req.param('evalId');
    const runner = getRunnerInstance();
    const result = await runner.recomputeStatusesForEval(evalId);
    return c.json(result, 200);
  })
  .post('/actions/clean/:evalId', async (c) => {
    const evalId = c.req.param('evalId');
    const runner = getRunnerInstance();
    const result = await runner.cleanRunsForEval(evalId);
    return c.json(result, 200);
  })
  .post('/', zValidator('json', createRunRequestSchema), async (c) => {
    const body = c.req.valid('json');
    const runner = getRunnerInstance();
    const configReload = runner.getConfigReloadState();
    if (configReload.status !== 'idle') {
      return c.json(
        {
          code: 'CONFIG_RELOAD_PENDING',
          error:
            'agent-evals.config.ts changed and the app is reloading before new runs can start.',
          configReload,
        },
        409,
      );
    }
    const validation = runner.validateManualInputs(body);
    if (!validation.ok) {
      return c.json(
        {
          error: 'Manual input validation failed',
          failures: validation.failures,
        },
        400,
      );
    }
    const runResult = await resultify(() => runner.startRun(body));
    if (runResult.error) {
      return c.json(
        {
          error: 'Failed to start run',
          message: formatUnknownErrorDetails(runResult.error),
        },
        500,
      );
    }
    return c.json(runResult.value, 201);
  })
  .post(
    '/actions/open-location',
    zValidator('json', openRunLocationRequestSchema),
    (c) => {
      const body = c.req.valid('json');
      const runner = getRunnerInstance();
      const workspaceRoot = runner.getWorkspaceRoot();
      const file = stripImportQuery(body.file);
      const absolutePath = isAbsolute(file)
        ? resolvePath(file)
        : resolvePath(workspaceRoot, file);
      if (!isInsideWorkspace(absolutePath, workspaceRoot)) {
        return c.json({ error: 'Resolved path escapes workspace' }, 400);
      }
      if (!existsSync(absolutePath)) {
        return c.json({ error: 'Source file not found on disk' }, 404);
      }
      const target = `${absolutePath}:${String(body.line)}:${String(body.column)}`;
      launch(target, (_fileName, errorMessage) => {
        if (errorMessage) {
          console.error(
            `[open-in-editor] failed for ${target}: ${errorMessage}`,
          );
        }
      });
      return c.json({ ok: true }, 200);
    },
  )
  .get('/:runId', (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();
    const run = runner.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }
    return c.json(run, 200);
  })
  .post('/:runId/cancel', async (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();
    await runner.cancelRun(runId);
    return c.json({ ok: true }, 200);
  })
  .delete('/:runId', async (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();
    const result = await runner.deleteRun(runId);
    if (!result.deleted) {
      return c.json(
        { error: 'Run not found or still running', deleted: false },
        404,
      );
    }
    return c.json(result, 200);
  })
  .get('/:runId/cases/:caseId', (c) => {
    const runId = c.req.param('runId');
    const caseId = c.req.param('caseId');
    const runner = getRunnerInstance();
    const caseDetail = runner.getCaseDetail(runId, caseId);
    if (!caseDetail) {
      return c.json({ error: 'Case not found' }, 404);
    }
    return c.json(caseDetail, 200);
  })
  .post(
    '/:runId/cases/:caseId/actions/recalculate-derived-attributes',
    async (c) => {
      const runId = c.req.param('runId');
      const caseId = c.req.param('caseId');
      const runner = getRunnerInstance();
      const result = await runner.recalculateDerivedAttributesForCase({
        runId,
        caseId,
      });
      if (!result.updated) {
        return c.json({ error: result.reason, updated: false }, 404);
      }
      return c.json(result, 200);
    },
  )
  .patch(
    '/:runId/cases/:caseId/manual-scores/:scoreKey',
    zValidator('json', updateManualScoreRequestSchema),
    async (c) => {
      const runId = c.req.param('runId');
      const caseId = c.req.param('caseId');
      const scoreKey = c.req.param('scoreKey');
      const body = c.req.valid('json');
      const runner = getRunnerInstance();
      const result = await runner.updateManualScore({
        runId,
        caseId,
        scoreKey,
        value: body.value,
      });
      if (!result.updated) {
        return c.json({ error: result.reason }, 404);
      }
      return c.json(result, 200);
    },
  )
  .get('/:runId/events', (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();

    return streamSSE(c, async (stream) => {
      type SseEvent = {
        type: string;
        runId?: string;
        timestamp: string;
        payload: unknown;
      };
      const writeEvent = async (event: SseEvent) => {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      };

      const cleanup = runner.subscribe(runId, (event) => {
        void writeEvent(event);
      });
      stream.onAbort(() => {
        cleanup();
      });

      const initial = runner.getRun(runId);
      if (initial) {
        const status = initial.manifest.status;
        if (
          status === 'completed' ||
          status === 'cancelled' ||
          status === 'error'
        ) {
          const now = new Date().toISOString();
          for (const caseRow of initial.cases) {
            await writeEvent({
              type: 'case.updated',
              runId,
              timestamp: now,
              payload: caseRow,
            });
          }
          await writeEvent({
            type: 'run.summary',
            runId,
            timestamp: now,
            payload: initial.summary,
          });
          const terminalType =
            status === 'completed'
              ? 'run.finished'
              : status === 'cancelled'
                ? 'run.cancelled'
                : 'run.error';
          await writeEvent({
            type: terminalType,
            runId,
            timestamp: now,
            payload:
              terminalType === 'run.error'
                ? {
                    message:
                      initial.summary.errorMessage ?? 'Run ended with error',
                  }
                : initial.summary,
          });
          return;
        }
      }

      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          const run = runner.getRun(runId);
          if (
            !run ||
            run.manifest.status === 'completed' ||
            run.manifest.status === 'cancelled' ||
            run.manifest.status === 'error'
          ) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 250);
      });
    });
  });
