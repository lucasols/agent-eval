import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createRunRequestSchema } from '@agent-evals/shared';
import { streamSSE } from 'hono/streaming';
import { getRunnerInstance } from '../runner.ts';

export const runsRoutes = new Hono()
  .get('/', (c) => {
    const runner = getRunnerInstance();
    const runs = runner.getRuns();
    return c.json(runs, 200);
  })
  .post('/', zValidator('json', createRunRequestSchema), async (c) => {
    const body = c.req.valid('json');
    const runner = getRunnerInstance();
    const run = await runner.startRun(body);
    return c.json(run, 201);
  })
  .get('/:runId', (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();
    const run = runner.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }
    return c.json(run, 200);
  })
  .post('/:runId/cancel', (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();
    runner.cancelRun(runId);
    return c.json({ ok: true }, 200);
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
                ? { message: 'Run ended with error' }
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
