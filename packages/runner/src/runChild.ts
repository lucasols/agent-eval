import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { configureEvalRunLogs } from '@agent-evals/sdk';
import {
  buildEvalKey,
  columnDefSchema,
  createRunRequestSchema,
  evalChartsConfigSchema,
  evalStatAggregateSchema,
  evalStatsConfigSchema,
  manualInputDescriptorSchema,
  runManifestSchema,
  runSummarySchema,
  type CreateRunRequest,
  type EvalSummary,
} from '@agent-evals/shared';
import { glob } from 'glob';
import { z } from 'zod/v4';
import { createFsCacheStore } from './cacheStore.ts';
import { loadConfig } from './config.ts';
import { parseEvalDiscovery } from './discovery.ts';
import { registerAgentEvalsPackageResolutionHooks } from './moduleIsolation.ts';
import type { RunChildContext, RunChildMessage } from './runChildProtocol.ts';
import { persistRunState } from './runMaintenance.ts';
import {
  executeRun,
  type EvalMeta,
  type RunState,
} from './runOrchestration.ts';
import type { EvalLatestRunInfo } from './runPersistence.ts';
import { getTargetEvals as resolveTargetEvals } from './targeting.ts';

const evalMetaSchema = z.object({
  key: z.string(),
  id: z.string(),
  title: z.string().optional(),
  filePath: z.string(),
  tags: z.array(z.string()).default([]),
  sourceFilePath: z.string(),
  sourceFingerprint: z.string().nullable(),
  columnDefs: z.array(columnDefSchema),
  caseCount: z.number().nullable(),
  caseIds: z.array(z.string()).optional(),
  stats: evalStatsConfigSchema.optional(),
  defaultStatAggregate: evalStatAggregateSchema.optional(),
  charts: evalChartsConfigSchema.optional(),
  manualInputDescriptor: manualInputDescriptorSchema.optional(),
  requiresManualInput: z.boolean().optional(),
});

const runChildContextSchema = z.object({
  request: createRunRequestSchema,
  workspaceRoot: z.string(),
  runDir: z.string(),
  manifest: runManifestSchema,
  summary: runSummarySchema,
  evals: z.array(evalMetaSchema).optional(),
});

let activeContext: RunChildContext | undefined;
let fatalErrorReported = false;
let disconnectExpected = false;
const pendingMessageSends = new Set<Promise<void>>();

function sendMessage(message: RunChildMessage): void {
  if (process.send === undefined) return;
  const sendPromise = new Promise<void>((resolvePromise) => {
    try {
      process.send?.(message, (error: Error | null) => {
        if (error) {
          console.error('Failed to send run child message:');
          console.error(formatUnknownErrorDetails(error));
        }
        resolvePromise();
      });
    } catch (error) {
      console.error('Failed to send run child message:');
      console.error(formatUnknownErrorDetails(error));
      resolvePromise();
    }
  });
  pendingMessageSends.add(sendPromise);
  void sendPromise.finally(() => {
    pendingMessageSends.delete(sendPromise);
  });
}

async function flushMessageSends(): Promise<void> {
  while (pendingMessageSends.size > 0) {
    await Promise.allSettled([...pendingMessageSends]);
  }
}

function installFatalRunChildErrorHandlers(): void {
  process.once('uncaughtException', (error) => {
    void reportFatalRunChildErrorAndExit(error);
  });
  process.once('unhandledRejection', (reason) => {
    void reportFatalRunChildErrorAndExit(toUnhandledRejectionError(reason));
  });
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
  return resolveTargetEvals({
    evals: params.evals.values(),
    request: params.request,
  });
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
    const metas = parseEvalDiscovery(filePath, source).metas;

    for (const meta of metas) {
      const relativeFilePath = toWorkspaceRelativePath({
        filePath: meta.filePath,
        workspaceRoot: params.workspaceRoot,
      });
      const key = buildEvalKey({ filePath: relativeFilePath, evalId: meta.id });
      evals.set(key, {
        key,
        id: meta.id,
        title: meta.title,
        filePath: relativeFilePath,
        tags: [],
        sourceFilePath: meta.filePath,
        sourceFingerprint,
        columnDefs: [],
        caseCount: null,
      });
    }
  }

  return [...evals.values()].toSorted(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.id.localeCompare(b.id),
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
    if (disconnectExpected) return;
    process.exit(1);
  });

  const context = await readContext(process.argv[2]);
  activeContext = context;
  process.chdir(context.workspaceRoot);
  registerAgentEvalsPackageResolutionHooks();

  const config = await loadConfig();
  configureEvalRunLogs({
    captureConsole: config.runLogs?.captureConsole !== false,
  });
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
  const evals = new Map(evalMetas.map((evalMeta) => [evalMeta.key, evalMeta]));
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
      [...evals.values()].toSorted(
        (a, b) =>
          a.filePath.localeCompare(b.filePath) || a.id.localeCompare(b.id),
      ),
    getTargetEvals: (request) => getTargetEvals({ evals, request }),
    onCaseFinished(caseDetail, caseRow) {
      sendMessage({ type: 'case.finished', caseDetail, caseRow });
    },
  });

  sendMessage({ type: 'done', evals: [...evals.values()] });
  await flushMessageSends();
}

async function handleFatalRunChildError(error: unknown): Promise<void> {
  if (fatalErrorReported) return;
  fatalErrorReported = true;
  const message = formatUnknownErrorDetails(error);
  process.exitCode = 1;
  console.error(message);

  if (activeContext === undefined) return;

  const endedAt = new Date().toISOString();
  const runState: RunState = {
    runDir: activeContext.runDir,
    manifest: { ...activeContext.manifest, status: 'error', endedAt },
    summary: {
      ...activeContext.summary,
      status: 'error',
      errorMessage: message,
    },
    cases: [],
    caseDetails: new Map(),
    listeners: new Set(),
  };

  await persistRunState(runState);
  sendMessage({
    type: 'event',
    event: {
      type: 'run.error',
      runId: activeContext.manifest.id,
      timestamp: endedAt,
      payload: { message },
    },
  });
  await flushMessageSends();
}

function formatUnknownErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function toUnhandledRejectionError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error(`Unhandled rejection: ${formatUnknownErrorDetails(reason)}`);
}

async function reportFatalRunChildErrorAndExit(error: unknown): Promise<void> {
  try {
    await handleFatalRunChildError(error);
  } catch (reportError) {
    console.error('Failed to report fatal run child error:');
    console.error(formatUnknownErrorDetails(reportError));
  } finally {
    process.exit(1);
  }
}

installFatalRunChildErrorHandlers();
await main().catch(async (error: unknown) => {
  await handleFatalRunChildError(error);
});
await flushMessageSends();
disconnectExpected = true;
process.disconnect();
