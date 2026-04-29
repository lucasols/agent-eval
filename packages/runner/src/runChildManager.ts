import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runSummarySchema,
  type CaseDetail,
  type CaseRow,
  type SseEnvelope,
} from '@agent-evals/shared';
import { isRunChildMessage, type RunChildMessage } from './runChildProtocol.ts';
import { persistRunState } from './runMaintenance.ts';
import type { EvalMeta, RunState } from './runOrchestration.ts';
import { loadPersistedRunSnapshot } from './runPersistence.ts';

const runChildInspectArgEnv = 'AGENT_EVALS_RUN_CHILD_INSPECT_ARG';
const inspectFlagPrefix = '--inspect';
const inspectBrkFlagPrefix = '--inspect-brk';

export type RunnerRunState = RunState & {
  childProcess: ChildProcess | undefined;
  childTerminalReceived: boolean;
};

type RunChildManagerContext = {
  workspaceRoot: string;
  evals: Map<string, EvalMeta>;
  emitEvent: (runState: RunState, event: SseEnvelope) => void;
  emitDiscoveryEvent: () => void;
};

export function startRunChild(params: {
  runState: RunnerRunState;
  contextPath: string;
  managerContext: RunChildManagerContext;
}): void {
  const child = spawn(
    process.execPath,
    [...getRunChildExecArgv(), resolveRunChildEntrypoint(), params.contextPath],
    {
      cwd: params.managerContext.workspaceRoot,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    },
  );

  params.runState.childProcess = child;
  child.on('message', (message) => {
    if (!isRunChildMessage(message)) return;
    handleRunChildMessage({
      runState: params.runState,
      message,
      managerContext: params.managerContext,
    });
  });
  child.once('exit', (code, signal) => {
    if (params.runState.childProcess === child) {
      params.runState.childProcess = undefined;
    }
    if (
      params.runState.manifest.status !== 'running' ||
      params.runState.childTerminalReceived
    ) {
      return;
    }

    const reason =
      signal !== null
        ? `Run child exited with signal ${signal}`
        : `Run child exited with code ${String(code)}`;
    void markRunErrored(params.runState, reason, params.managerContext);
  });
}

function getRunChildExecArgv(): string[] {
  const execArgv: string[] = [];
  let skipNext = false;

  for (const arg of process.execArgv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg === '--eval' || arg === '-e' || arg === '--print' || arg === '-p') {
      skipNext = true;
      continue;
    }

    if (arg.startsWith('--eval=') || arg.startsWith('--print=')) continue;
    if (arg === '--input-type' || arg.startsWith('--input-type=')) {
      if (arg === '--input-type') skipNext = true;
      continue;
    }
    if (isInspectArg(arg)) continue;

    execArgv.push(arg);
  }

  const inspectArg = process.env[runChildInspectArgEnv];
  if (inspectArg !== undefined && isInspectArg(inspectArg)) {
    execArgv.push(inspectArg);
  }

  return execArgv;
}

function isInspectArg(arg: string): boolean {
  return (
    arg === inspectFlagPrefix ||
    arg.startsWith(`${inspectFlagPrefix}=`) ||
    arg === inspectBrkFlagPrefix ||
    arg.startsWith(`${inspectBrkFlagPrefix}=`)
  );
}

export function killRunChild(runState: RunnerRunState): void {
  const child = runState.childProcess;
  runState.childProcess = undefined;
  if (child === undefined || child.killed) return;
  if (!child.kill('SIGKILL')) {
    child.kill();
  }
}

function resolveRunChildEntrypoint(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  for (const fileName of ['runChild.ts', 'runChild.mjs', 'runChild.js']) {
    const candidate = join(currentDir, fileName);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to locate the Agent Evals run child entrypoint.');
}

function handleRunChildMessage(params: {
  runState: RunnerRunState;
  message: RunChildMessage;
  managerContext: RunChildManagerContext;
}): void {
  const { runState, message, managerContext } = params;
  if (message.type === 'case.finished') {
    if (runState.manifest.status !== 'running') return;
    upsertFinishedCase(runState, message.caseDetail, message.caseRow);
    managerContext.emitEvent(runState, {
      type: 'case.finished',
      runId: runState.manifest.id,
      timestamp: new Date().toISOString(),
      payload: message.caseRow,
    });
    return;
  }

  if (message.type === 'done') {
    applyChildEvalMetas(managerContext.evals, message.evals);
    managerContext.emitDiscoveryEvent();
    return;
  }

  handleRunChildEvent(runState, message.event, managerContext);
}

function upsertFinishedCase(
  runState: RunnerRunState,
  caseDetail: CaseDetail,
  caseRow: CaseRow,
): void {
  const existingIndex = runState.cases.findIndex(
    (row) =>
      row.evalId === caseRow.evalId &&
      row.caseId === caseRow.caseId &&
      row.trial === caseRow.trial,
  );
  if (existingIndex === -1) {
    runState.cases.push(caseRow);
  } else {
    runState.cases[existingIndex] = caseRow;
  }
  runState.caseDetails.set(caseDetail.caseId, caseDetail);
}

function applyChildEvalMetas(
  evals: Map<string, EvalMeta>,
  childMetas: EvalMeta[],
): void {
  for (const childMeta of childMetas) {
    const evalMeta = evals.get(childMeta.id);
    if (evalMeta === undefined) {
      evals.set(childMeta.id, childMeta);
      continue;
    }
    evalMeta.columnDefs = childMeta.columnDefs;
    evalMeta.caseCount = childMeta.caseCount;
    evalMeta.stats = childMeta.stats;
    evalMeta.charts = childMeta.charts;
    evalMeta.sourceFingerprint = childMeta.sourceFingerprint;
  }
}

function handleRunChildEvent(
  runState: RunnerRunState,
  event: SseEnvelope,
  managerContext: RunChildManagerContext,
): void {
  if (runState.manifest.status !== 'running') return;

  if (event.type === 'run.summary') {
    const parsed = runSummarySchema.safeParse(event.payload);
    if (parsed.success) {
      runState.summary = parsed.data;
    }
    managerContext.emitEvent(runState, event);
    return;
  }

  if (event.type === 'run.finished') {
    runState.childTerminalReceived = true;
    runState.childProcess = undefined;
    void markRunTerminalFromChild(runState, event, managerContext);
    return;
  }

  if (event.type === 'run.error') {
    runState.childTerminalReceived = true;
    runState.childProcess = undefined;
    void markRunTerminalFromChild(runState, event, managerContext);
    return;
  }

  managerContext.emitEvent(runState, event);
}

function getRunErrorMessage(payload: unknown): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }
  return 'Run child ended with an error';
}

async function markRunErrored(
  runState: RunnerRunState,
  message: string,
  managerContext: RunChildManagerContext,
): Promise<void> {
  runState.manifest.status = 'error';
  runState.manifest.endedAt = new Date().toISOString();
  runState.summary.status = 'error';
  runState.summary.errorMessage = message;
  await persistRunState(runState);
  managerContext.emitEvent(runState, {
    type: 'run.error',
    runId: runState.manifest.id,
    timestamp: new Date().toISOString(),
    payload: { message },
  });
  managerContext.emitDiscoveryEvent();
}

async function markRunTerminalFromChild(
  runState: RunnerRunState,
  event: SseEnvelope,
  managerContext: RunChildManagerContext,
): Promise<void> {
  const snapshot = await loadPersistedRunSnapshot(runState.runDir);
  if (snapshot !== null) {
    runState.manifest = snapshot.manifest;
    runState.summary = snapshot.summary;
    runState.cases = snapshot.cases;
    runState.caseDetails = snapshot.caseDetails;
  } else if (event.type === 'run.finished') {
    runState.manifest.status = 'completed';
    runState.manifest.endedAt = new Date().toISOString();
    const parsed = runSummarySchema.safeParse(event.payload);
    if (parsed.success) runState.summary = parsed.data;
  } else {
    runState.manifest.status = 'error';
    runState.manifest.endedAt = new Date().toISOString();
    runState.summary.status = 'error';
    runState.summary.errorMessage = getRunErrorMessage(event.payload);
  }
  managerContext.emitEvent(runState, event);
  managerContext.emitDiscoveryEvent();
}
