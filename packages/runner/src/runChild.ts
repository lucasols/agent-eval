import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import {
  columnDefSchema,
  createRunRequestSchema,
  evalChartsConfigSchema,
  evalStatsConfigSchema,
  runManifestSchema,
  runSummarySchema,
  type CreateRunRequest,
  type EvalSummary,
} from '@agent-evals/shared';
import { glob } from 'glob';
import { z } from 'zod/v4';
import { createFsCacheStore } from './cacheStore.ts';
import { loadConfig } from './config.ts';
import { parseEvalMetas } from './discovery.ts';
import type { RunChildContext, RunChildMessage } from './runChildProtocol.ts';
import {
  executeRun,
  type EvalMeta,
  type RunState,
} from './runOrchestration.ts';
import type { EvalLatestRunInfo } from './runPersistence.ts';

const evalMetaSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  filePath: z.string(),
  sourceFilePath: z.string(),
  sourceFingerprint: z.string().nullable(),
  columnDefs: z.array(columnDefSchema),
  caseCount: z.number().nullable(),
  stats: evalStatsConfigSchema.optional(),
  charts: evalChartsConfigSchema.optional(),
});

const runChildContextSchema = z.object({
  request: createRunRequestSchema,
  workspaceRoot: z.string(),
  runDir: z.string(),
  manifest: runManifestSchema,
  summary: runSummarySchema,
  evals: z.array(evalMetaSchema).optional(),
});

function sendMessage(message: RunChildMessage): void {
  if (process.send === undefined) return;
  process.send(message);
}

function getSourceFingerprint(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function getConfiguredConcurrency(configConcurrency: number | undefined) {
  if (
    typeof configConcurrency !== 'number' ||
    !Number.isFinite(configConcurrency)
  ) {
    return 1;
  }

  return Math.max(1, Math.floor(configConcurrency));
}

function getTargetEvals(params: {
  evals: Map<string, EvalMeta>;
  request: CreateRunRequest;
}): EvalMeta[] {
  if (
    params.request.target.evalIds &&
    params.request.target.evalIds.length > 0
  ) {
    return params.request.target.evalIds
      .map((id) => params.evals.get(id))
      .filter((entry): entry is EvalMeta => entry !== undefined);
  }
  return [...params.evals.values()].toSorted((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );
}

function toWorkspaceRelativePath(params: {
  filePath: string;
  workspaceRoot: string;
}): string {
  return relative(params.workspaceRoot, params.filePath).replaceAll('\\', '/');
}

async function discoverRunEvals(params: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  workspaceRoot: string;
}): Promise<EvalMeta[]> {
  const discovered: string[] = [];

  for (const pattern of params.config.include) {
    const files = await glob(pattern, {
      cwd: params.workspaceRoot,
      absolute: true,
    });
    discovered.push(...files);
  }

  const evals = new Map<string, EvalMeta>();
  for (const filePath of discovered) {
    const source = await readFile(filePath, 'utf-8');
    const sourceFingerprint = getSourceFingerprint(source);
    const metas = parseEvalMetas(filePath, source);

    for (const meta of metas) {
      evals.set(meta.id, {
        id: meta.id,
        title: meta.title,
        filePath: toWorkspaceRelativePath({
          filePath: meta.filePath,
          workspaceRoot: params.workspaceRoot,
        }),
        sourceFilePath: meta.filePath,
        sourceFingerprint,
        columnDefs: [],
        caseCount: null,
      });
    }
  }

  return [...evals.values()].toSorted((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );
}

async function readContext(contextPath: string | undefined) {
  if (contextPath === undefined) {
    throw new Error('Missing run child context path');
  }
  return runChildContextSchema.parse(
    JSON.parse(await readFile(contextPath, 'utf-8')),
  ) satisfies RunChildContext;
}

async function main(): Promise<void> {
  process.on('disconnect', () => {
    process.exit(1);
  });

  const context = await readContext(process.argv[2]);
  process.chdir(context.workspaceRoot);

  const config = await loadConfig();
  const cacheStore = createFsCacheStore({
    workspaceRoot: context.workspaceRoot,
    dir: config.cache?.dir,
    maxEntriesPerNamespace:
      config.cache?.maxEntriesPerNamespace ?? config.cache?.maxEntriesPerEval,
    maxEntriesByNamespace: config.cache?.maxEntriesByNamespace,
  });
  const evalMetas = await discoverRunEvals({
    config,
    workspaceRoot: context.workspaceRoot,
  });
  const evals = new Map(evalMetas.map((evalMeta) => [evalMeta.id, evalMeta]));
  const lastRunStatusMap = new Map<string, EvalSummary['lastRunStatus']>();
  const latestRunInfoMap = new Map<string, EvalLatestRunInfo>();

  const runState: RunState = {
    runDir: context.runDir,
    manifest: context.manifest,
    summary: context.summary,
    cases: [],
    caseDetails: new Map(),
    listeners: new Set(),
  };

  await executeRun({
    runState,
    request: context.request,
    runDir: context.runDir,
    config,
    evals,
    cacheStore,
    lastRunStatusMap,
    latestRunInfoMap,
    emitEvent(_runState, event) {
      if (event.type === 'case.finished') return;
      sendMessage({ type: 'event', event });
    },
    emitDiscoveryEvent() {},
    workspaceRoot: context.workspaceRoot,
    getSourceFingerprint,
    getConfiguredConcurrency: () =>
      getConfiguredConcurrency(config.concurrency),
    getSortedEvalMetas: () =>
      [...evals.values()].toSorted((a, b) =>
        a.filePath.localeCompare(b.filePath),
      ),
    getTargetEvals: (request) => getTargetEvals({ evals, request }),
    onCaseFinished(caseDetail, caseRow) {
      sendMessage({ type: 'case.finished', caseDetail, caseRow });
    },
  });

  sendMessage({ type: 'done', evals: [...evals.values()] });
}

await main();
process.disconnect();
