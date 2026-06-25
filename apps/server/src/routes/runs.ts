import { existsSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath, sep } from 'node:path';
import {
  caseRowSchema,
  createRunRequestSchema,
  getEvalTitle,
  getCaseRowCaseKey,
  type CreateRunRequest,
  type EvalSummary,
  type RunSummary,
  updateManualScoreRequestSchema,
} from '@agent-evals/shared';
import { zValidator } from '@hono/zod-validator';
import type { EvalRunner } from '@ls-stack/agent-eval';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import launch from 'launch-editor';
import { resultify } from 't-result';
import { z } from 'zod';
import { getRunnerInstance } from '../runner.ts';

const openRunLocationRequestSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().min(1),
  column: z.number().int().min(1),
});
const importQuerySeparatorRegex = /[?#]/;

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replaceAll('\\', '/');
  let regex = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      i++;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegex(char ?? '');
    }
  }
  return new RegExp(`${regex}$`);
}

function fileMatches(pattern: string, filePath: string): boolean {
  const normalizedPattern = pattern.replaceAll('\\', '/');
  if (normalizedPattern === filePath) return true;
  return globToRegex(normalizedPattern).test(filePath);
}

function matchesRunTarget(
  ev: EvalSummary,
  target: CreateRunRequest['target'],
): boolean {
  if (target.evalKeys !== undefined && target.evalKeys.length > 0) {
    if (!target.evalKeys.includes(ev.key)) return false;
  }
  if (target.evalIds !== undefined && target.evalIds.length > 0) {
    if (!target.evalIds.includes(ev.id)) return false;
  }
  if (target.files !== undefined && target.files.length > 0) {
    if (!target.files.some((file) => fileMatches(file, ev.filePath))) {
      return false;
    }
  }
  return true;
}

function getRunTargetEvalSummaries(
  evals: EvalSummary[],
  target: CreateRunRequest['target'],
): EvalSummary[] {
  return evals
    .filter((ev) => matchesRunTarget(ev, target))
    .toSorted(
      (left, right) =>
        left.filePath.localeCompare(right.filePath) ||
        left.id.localeCompare(right.id),
    );
}

function logStartedAppRunEvals(params: {
  runId: string;
  shortId: string;
  evals: EvalSummary[];
  target: CreateRunRequest['target'];
  concurrency: number;
}): void {
  const targetEvals = getRunTargetEvalSummaries(params.evals, params.target);
  if (targetEvals.length === 0) return;

  const label = targetEvals.length === 1 ? 'eval' : 'evals';
  console.info(
    `[agent-evals] Queued app run ${params.shortId} (${params.runId}) with ${String(targetEvals.length)} ${label}; concurrency ${String(params.concurrency)}:`,
  );
  for (const ev of targetEvals) {
    console.info(`  - ${getEvalTitle(ev)} (${ev.filePath}#${ev.id})`);
  }
}

function getEvalSummaryLabel(
  evalsByKey: ReadonlyMap<string, EvalSummary>,
  evalsById: ReadonlyMap<string, EvalSummary>,
  evalKey: string | undefined,
  evalId: string,
): string {
  const ev = evalKey === undefined ? undefined : evalsByKey.get(evalKey);
  const summary = ev ?? evalsById.get(evalId);
  if (summary === undefined) return evalId;
  return `${getEvalTitle(summary)} (${summary.filePath}#${summary.id})`;
}

function getRunCaseLabel(caseId: string, caseKey: string | undefined): string {
  return caseKey === undefined || caseKey === caseId
    ? caseId
    : `${caseId} [${caseKey}]`;
}

function formatCaseStartedLog(params: {
  shortId: string;
  activeCount: number;
  concurrency: number;
  evalLabel: string;
  caseLabel: string;
}): string {
  return [
    `[agent-evals] Run ${params.shortId} started `,
    `${String(params.activeCount)}/${String(params.concurrency)}: `,
    `${params.evalLabel} / ${params.caseLabel}`,
  ].join('');
}

function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null) return '';
  if (durationMs < 1000) return ` in ${String(durationMs)}ms`;
  return ` in ${(durationMs / 1000).toFixed(1)}s`;
}

function formatRunCallSummary(summary: RunSummary): string {
  const parts: string[] = [];
  if (summary.llmCalls > 0 || summary.llmCacheHits > 0) {
    parts.push(
      `LLM calls: ${String(summary.llmCallsMade)} made, ${String(summary.llmCacheHits)} cached`,
    );
  }
  if (summary.cacheOperations > 0) {
    parts.push(
      `cache: ${String(summary.cacheHits)}/${String(summary.cacheOperations)} hits`,
    );
  }
  return parts.length === 0 ? '' : `; ${parts.join('; ')}`;
}

function formatRunResultSummary(summary: RunSummary): string {
  const cancelled =
    summary.cancelledCases > 0
      ? `, ${String(summary.cancelledCases)} cancelled`
      : '';
  return `${summary.status}: ${String(summary.totalCases)} total, ${String(summary.passedCases)} passed, ${String(summary.failedCases)} failed, ${String(summary.errorCases)} errors${cancelled}${formatRunCallSummary(summary)}${formatDurationMs(summary.totalDurationMs)}`;
}

function isTerminalRunEvent(eventType: string): boolean {
  return (
    eventType === 'run.finished' ||
    eventType === 'run.error' ||
    eventType === 'run.cancelled'
  );
}

function subscribeToAppRunResultLog(params: {
  runner: Pick<EvalRunner, 'getRun' | 'subscribe'>;
  runId: string;
  shortId: string;
  evals: EvalSummary[];
  concurrency: number;
}): void {
  const evalsByKey = new Map(params.evals.map((ev) => [ev.key, ev]));
  const evalsById = new Map(params.evals.map((ev) => [ev.id, ev]));
  const activeCases = new Set<string>();
  const loggedStarts = new Set<string>();
  let unsubscribe: (() => void) | undefined;
  unsubscribe = params.runner.subscribe(params.runId, (event) => {
    if (event.type === 'case.started') {
      const parsed = caseRowSchema.safeParse(event.payload);
      if (!parsed.success) return;

      const caseRow = parsed.data;
      const caseKey = `${getCaseRowCaseKey(caseRow)}:${String(caseRow.trial)}`;
      activeCases.add(caseKey);
      if (loggedStarts.has(caseKey)) return;
      loggedStarts.add(caseKey);

      console.info(
        formatCaseStartedLog({
          shortId: params.shortId,
          activeCount: activeCases.size,
          concurrency: params.concurrency,
          evalLabel: getEvalSummaryLabel(
            evalsByKey,
            evalsById,
            caseRow.evalKey,
            caseRow.evalId,
          ),
          caseLabel: getRunCaseLabel(caseRow.caseId, caseRow.caseKey),
        }),
      );
      return;
    }

    if (event.type === 'case.finished') {
      const parsed = caseRowSchema.safeParse(event.payload);
      if (parsed.success) {
        activeCases.delete(
          `${getCaseRowCaseKey(parsed.data)}:${String(parsed.data.trial)}`,
        );
      }
      return;
    }

    if (!isTerminalRunEvent(event.type)) return;
    unsubscribe?.();
    unsubscribe = undefined;

    const run = params.runner.getRun(params.runId);
    if (run === undefined) {
      console.info(
        `[agent-evals] Run ${params.shortId} (${params.runId}) finished.`,
      );
      return;
    }

    console.info(
      `[agent-evals] Run ${params.shortId} (${params.runId}) ${formatRunResultSummary(run.summary)}`,
    );
  });
}

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
  .get('/history', (c) => {
    const runner = getRunnerInstance();
    const runs = runner
      .getRuns()
      .map((manifest) => runner.getRun(manifest.id))
      .filter((run) => run !== undefined);
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
    const evalsForTerminalLog = runner.getEvals();
    const concurrency = runner.getConfiguredConcurrency();
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
    logStartedAppRunEvals({
      runId: runResult.value.manifest.id,
      shortId: runResult.value.manifest.shortId,
      evals: evalsForTerminalLog,
      target: body.target,
      concurrency,
    });
    subscribeToAppRunResultLog({
      runner,
      runId: runResult.value.manifest.id,
      shortId: runResult.value.manifest.shortId,
      evals: evalsForTerminalLog,
      concurrency,
    });
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
  .post('/:runId/promote', async (c) => {
    const runId = c.req.param('runId');
    const runner = getRunnerInstance();
    const result = await runner.promoteRun(runId);
    if (!('run' in result)) {
      return c.json({ error: 'Run not found', promoted: false }, 404);
    }
    return c.json(result, 200);
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
