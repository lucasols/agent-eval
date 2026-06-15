import {
  configureEvalRunLogs,
  runInEvalRuntimeScope,
  runWithEvalRegistry,
} from '@agent-evals/sdk';
import type { EvalDefinition, EvalOutputs } from '@agent-evals/sdk';
import {
  resolveApiCallsConfig,
  resolveLlmCallsConfig,
} from '@agent-evals/shared';
import { getCacheRetentionOptions } from './cacheConfig.ts';
import { createBufferedCacheStore, createFsCacheStore } from './cacheStore.ts';
import {
  isCaseChildParentMessage,
  type CaseChildContext,
  type CaseChildMessage,
  type CaseChildResult,
} from './caseChildProtocol.ts';
import { loadConfig } from './config.ts';
import { loadEvalModule } from './evalModuleLoader.ts';
import { registerAgentEvalsPackageResolutionHooks } from './moduleIsolation.ts';
import { runCase } from './runExecution.ts';

let fatalErrorReported = false;
let disconnectExpected = false;
let runStarted = false;
const pendingMessageSends = new Set<Promise<void>>();

function sendMessage(message: CaseChildMessage): void {
  if (process.send === undefined) return;
  const sendPromise = new Promise<void>((resolvePromise) => {
    try {
      process.send?.(message, (error: Error | null) => {
        if (error) {
          console.error('Failed to send case child message:');
          console.error(formatUnknownErrorDetails(error));
        }
        resolvePromise();
      });
    } catch (error) {
      console.error('Failed to send case child message:');
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

function installFatalCaseChildErrorHandlers(): void {
  process.once('uncaughtException', (error) => {
    void reportFatalCaseChildErrorAndExit(error);
  });
  process.once('unhandledRejection', (reason) => {
    void reportFatalCaseChildErrorAndExit(toUnhandledRejectionError(reason));
  });
}

async function useEvalDefinition<TResult>(params: {
  evalId: string;
  evalFilePath: string;
  sourceFingerprint: string | undefined;
  use: <TInput, TOutputs extends EvalOutputs>(
    evalDef: EvalDefinition<TInput, TOutputs>,
  ) => Promise<TResult>;
}): Promise<TResult> {
  const registry = await runWithEvalRegistry(async (activeRegistry) => {
    await runInEvalRuntimeScope('env', async () => {
      await loadEvalModule(params.evalFilePath, params.sourceFingerprint);
    });
    return activeRegistry;
  });
  const entry = registry.get(params.evalId);
  if (entry === undefined) {
    throw new Error(
      `Eval "${params.evalId}" was not registered after importing ${params.evalFilePath}`,
    );
  }

  return await entry.use(async (evalDef) => await params.use(evalDef));
}

async function executeCaseChild(
  context: CaseChildContext,
): Promise<CaseChildResult> {
  process.chdir(context.workspaceRoot);
  registerAgentEvalsPackageResolutionHooks();

  const config = await loadConfig();
  configureEvalRunLogs({
    captureConsole: config.runLogs?.captureConsole !== false,
  });
  const cacheRetentionOptions = getCacheRetentionOptions(config.cache);
  const cacheStore = createFsCacheStore({
    workspaceRoot: context.workspaceRoot,
    dir: config.cache?.dir,
    maxBytesPerNamespace: cacheRetentionOptions.maxBytesPerNamespace,
    maxBytesByNamespace: cacheRetentionOptions.maxBytesByNamespace,
    lastAccessedAtUpdateIntervalMs:
      config.cache?.lastAccessedAtUpdateIntervalMs,
  });
  const bufferedCacheStore =
    context.cacheEnabled && context.cacheMode !== 'bypass'
      ? createBufferedCacheStore(cacheStore)
      : null;
  const llmCallsConfig = resolveLlmCallsConfig(config.llmCalls);
  const apiCallsConfig = resolveApiCallsConfig(config.apiCalls);

  const { caseDetail, caseRowUpdate } = await useEvalDefinition({
    evalId: context.evalId,
    evalFilePath: context.evalFilePath,
    sourceFingerprint: context.sourceFingerprint,
    use: async (evalDef) =>
      await runCase({
        evalDef,
        evalId: context.evalId,
        evalKey: context.evalKey,
        evalCase: context.evalCase,
        globalTraceDisplay: context.globalTraceDisplay,
        globalColumns: config.columns,
        globalDeriveFromTracing: config.deriveFromTracing,
        globalTracingAssertions: config.tracingAssertions,
        llmCallsConfig,
        apiCallsConfig,
        globalRemoveDefaultConfig: config.removeDefaultConfig,
        trial: context.trial,
        startTime: context.startTime,
        cacheAdapter:
          bufferedCacheStore ?? (context.cacheEnabled ? cacheStore : null),
        cacheMode: context.cacheMode,
        moduleIsolation: undefined,
        evalFilePath: context.evalFilePath,
        evalFileRelativePath: context.evalFileRelativePath,
        workspaceRoot: context.workspaceRoot,
        artifactDir: context.artifactDir,
        runId: context.runId,
      }),
  });

  return {
    caseDetail,
    caseRow: {
      caseId: context.evalCase.id,
      evalId: context.evalId,
      evalKey: context.evalKey,
      caseKey: caseDetail.caseKey,
      tags: caseDetail.tags,
      status: caseRowUpdate.status ?? 'pending',
      durationMs: caseRowUpdate.durationMs ?? null,
      cacheHits: caseRowUpdate.cacheHits ?? 0,
      cacheOperations: caseRowUpdate.cacheOperations ?? 0,
      columns: caseRowUpdate.columns ?? {},
      ...(caseRowUpdate.outputColumnDefs !== undefined
        ? { outputColumnDefs: caseRowUpdate.outputColumnDefs }
        : {}),
      trial: context.trial,
    },
    pendingCacheWrites: bufferedCacheStore?.getPendingWrites() ?? [],
  };
}

async function handleFatalCaseChildError(error: unknown): Promise<void> {
  if (fatalErrorReported) return;
  fatalErrorReported = true;
  const message = formatUnknownErrorDetails(error);
  process.exitCode = 1;
  console.error(message);
  sendMessage({ type: 'error', message });
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

async function reportFatalCaseChildErrorAndExit(error: unknown): Promise<void> {
  try {
    await handleFatalCaseChildError(error);
  } catch (reportError) {
    console.error('Failed to report fatal case child error:');
    console.error(formatUnknownErrorDetails(reportError));
  } finally {
    process.exit(1);
  }
}

installFatalCaseChildErrorHandlers();

process.on('disconnect', () => {
  if (disconnectExpected) return;
  process.exit(1);
});

process.on('message', (message: unknown) => {
  if (runStarted) return;
  runStarted = true;

  if (!isCaseChildParentMessage(message)) {
    void reportFatalCaseChildErrorAndExit(
      new Error('Case child received an invalid start message'),
    );
    return;
  }

  void executeCaseChild(message.context)
    .then(async (result) => {
      sendMessage({ type: 'done', result });
      await flushMessageSends();
      disconnectExpected = true;
      process.disconnect();
    })
    .catch(async (error: unknown) => {
      await handleFatalCaseChildError(error);
      disconnectExpected = true;
      process.disconnect();
    });
});
