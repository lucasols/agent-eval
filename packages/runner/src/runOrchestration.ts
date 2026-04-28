import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getEvalRegistry } from '@agent-evals/sdk';
import type {
  AgentEvalsConfig,
  CacheMode,
  CaseDetail,
  CaseRow,
  ColumnDef,
  CreateRunRequest,
  EvalChartsConfig,
  EvalStatsConfig,
  EvalSummary,
  RunManifest,
  RunSummary,
  SseEnvelope,
  TrialSelectionMode,
} from '@agent-evals/shared';
import { deriveStatusFromCaseRows } from '@agent-evals/shared';
import {
  createBufferedCacheStore,
  type BufferedCacheStore,
  type FsCacheStore,
} from './cacheStore.ts';
import { mergeColumnDefs } from './columnBuilder.ts';
import { loadEvalModule } from './evalModuleLoader.ts';
import { getTargetEvalIds } from './evalSummaries.ts';
import { runWithModuleIsolation } from './moduleIsolation.ts';
import {
  filterEvalCases,
  resolveRunnableEvalCases,
  runCase,
} from './runExecution.ts';
import { persistRunState } from './runMaintenance.ts';
import { persistCaseDetail, type EvalLatestRunInfo } from './runPersistence.ts';
import { executeQueuedCases, type QueuedCaseRun } from './runQueue.ts';

export type EvalMeta = {
  id: string;
  title?: string;
  filePath: string;
  sourceFilePath: string;
  sourceFingerprint: string | null;
  columnDefs: ColumnDef[];
  caseCount: number | null;
  stats?: EvalStatsConfig;
  charts?: EvalChartsConfig;
};

export type RunState = {
  runDir: string;
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
  caseDetails: Map<string, CaseDetail>;
  listeners: Set<(event: SseEnvelope) => void>;
};

type TrialExecutionResult = {
  caseDetail: CaseDetail;
  caseRow: CaseRow;
  bufferedCacheStore: BufferedCacheStore | null;
};

type PreparedEvalCase = {
  caseId: string;
  trialResults: TrialExecutionResult[];
  finalized: boolean;
};

type PreparedEvalRun = {
  evalMeta: EvalMeta;
  accumulatedColumns: Map<string, ColumnDef>;
  evalCaseRows: CaseRow[];
  preparedCases: PreparedEvalCase[];
  scoreKeys: readonly string[];
  mergeColumns: (columns: CaseDetail['columns']) => void;
};

type ExecuteRunParams = {
  runState: RunState;
  request: CreateRunRequest;
  runDir: string;
  config: AgentEvalsConfig;
  evals: Map<string, EvalMeta>;
  cacheStore: FsCacheStore;
  lastRunStatusMap: Map<string, EvalSummary['lastRunStatus']>;
  latestRunInfoMap: Map<string, EvalLatestRunInfo>;
  emitEvent: (runState: RunState, event: SseEnvelope) => void;
  emitDiscoveryEvent: () => void;
  workspaceRoot: string;
  getSourceFingerprint: (source: string) => string;
  getConfiguredConcurrency: () => number;
  getSortedEvalMetas: () => EvalMeta[];
  getTargetEvals: (request: CreateRunRequest) => EvalMeta[];
  onCaseFinished?: (caseDetail: CaseDetail, caseRow: CaseRow) => void;
};

/**
 * Ranks case statuses from worst to best. Used to order trial attempts so the
 * pessimistic (`lowestScore`) strategy can pick the worst attempt. Any
 * non-terminal status outside `pass`/`fail`/`error` is treated as indistinct
 * from `fail` for comparison purposes.
 */
function statusRank(status: CaseRow['status']): number {
  if (status === 'pass') return 2;
  if (status === 'error') return 0;
  return 1;
}

/**
 * Returns the minimum numeric value across the declared score columns for a
 * trial, or `-Infinity` when no score has a numeric value. Used as a
 * tiebreaker between trials that share the same status.
 */
function minScoreValue(caseRow: CaseRow, scoreKeys: readonly string[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const key of scoreKeys) {
    const v = caseRow.columns[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < min) min = v;
    }
  }
  return Number.isFinite(min) ? min : Number.NEGATIVE_INFINITY;
}

function compareTrialResults(
  left: TrialExecutionResult,
  right: TrialExecutionResult,
  scoreKeys: readonly string[],
): number {
  const statusDiff =
    statusRank(left.caseRow.status) - statusRank(right.caseRow.status);
  if (statusDiff !== 0) return statusDiff;
  const scoreDiff =
    minScoreValue(left.caseRow, scoreKeys) -
    minScoreValue(right.caseRow, scoreKeys);
  if (scoreDiff !== 0) return scoreDiff;
  return left.caseRow.trial - right.caseRow.trial;
}

function pickWinningTrial(params: {
  strategy: TrialSelectionMode;
  attempts: TrialExecutionResult[];
  scoreKeys: readonly string[];
}): TrialExecutionResult {
  const orderedAttempts = [...params.attempts].toSorted((left, right) =>
    compareTrialResults(left, right, params.scoreKeys),
  );
  if (params.strategy === 'lowestScore') {
    const [lowestAttempt] = orderedAttempts;
    if (lowestAttempt === undefined) {
      throw new Error('Expected at least one trial attempt');
    }
    return lowestAttempt;
  }

  const medianIndex = Math.floor((orderedAttempts.length - 1) / 2);
  const medianAttempt = orderedAttempts[medianIndex];
  if (medianAttempt === undefined) {
    throw new Error('Expected at least one trial attempt');
  }
  return medianAttempt;
}

async function finalizePreparedCase(params: {
  runState: RunState;
  runDir: string;
  preparedEval: PreparedEvalRun;
  preparedCase: PreparedEvalCase;
  onCaseFinished: ExecuteRunParams['onCaseFinished'];
  emitEvent: ExecuteRunParams['emitEvent'];
}): Promise<void> {
  const {
    runState,
    runDir,
    preparedEval,
    preparedCase,
    onCaseFinished,
    emitEvent,
  } = params;
  if (preparedCase.finalized || preparedCase.trialResults.length === 0) return;
  preparedCase.finalized = true;

  const winningTrial = pickWinningTrial({
    strategy: runState.manifest.trialSelection,
    attempts: preparedCase.trialResults,
    scoreKeys: preparedEval.scoreKeys,
  });

  if (winningTrial.bufferedCacheStore !== null) {
    await winningTrial.bufferedCacheStore.commit();
  }

  runState.cases.push(winningTrial.caseRow);
  runState.caseDetails.set(preparedCase.caseId, winningTrial.caseDetail);
  preparedEval.mergeColumns(winningTrial.caseDetail.columns);

  if (winningTrial.caseRow.status === 'pass') {
    runState.summary.passedCases++;
  } else if (winningTrial.caseRow.status === 'error') {
    runState.summary.errorCases++;
  } else {
    runState.summary.failedCases++;
  }

  await writeFile(
    join(runDir, 'traces', `${preparedCase.caseId}.json`),
    JSON.stringify(winningTrial.caseDetail.trace, null, 2),
  );
  await persistCaseDetail(runDir, winningTrial.caseDetail);
  onCaseFinished?.(winningTrial.caseDetail, winningTrial.caseRow);

  emitEvent(runState, {
    type: 'case.finished',
    runId: runState.manifest.id,
    timestamp: new Date().toISOString(),
    payload: winningTrial.caseRow,
  });

  preparedEval.evalCaseRows.push(winningTrial.caseRow);
}

function getPreparedCaseOrderKey(caseRow: CaseRow): string {
  return `${caseRow.evalId}\u0000${caseRow.caseId}`;
}

function sortCaseRowsByPreparedOrder(
  caseRows: CaseRow[],
  preparedEvals: PreparedEvalRun[],
): void {
  const orderByCase = new Map<string, number>();
  let order = 0;
  for (const preparedEval of preparedEvals) {
    for (const preparedCase of preparedEval.preparedCases) {
      orderByCase.set(
        `${preparedEval.evalMeta.id}\u0000${preparedCase.caseId}`,
        order,
      );
      order++;
    }
  }

  caseRows.sort((left, right) => {
    const leftOrder =
      orderByCase.get(getPreparedCaseOrderKey(left)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      orderByCase.get(getPreparedCaseOrderKey(right)) ??
      Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

export async function executeRun({
  runState,
  request,
  runDir,
  config,
  evals,
  cacheStore,
  lastRunStatusMap,
  latestRunInfoMap,
  emitEvent,
  emitDiscoveryEvent,
  workspaceRoot,
  getSourceFingerprint,
  getConfiguredConcurrency,
  getSortedEvalMetas,
  getTargetEvals,
  onCaseFinished,
}: ExecuteRunParams): Promise<void> {
  try {
    const targetEvals = getTargetEvals(request);

    emitEvent(runState, {
      type: 'run.started',
      runId: runState.manifest.id,
      timestamp: new Date().toISOString(),
      payload: runState.manifest,
    });

    const evalErrors: { evalId: string; message: string }[] = [];
    const queuedCases: QueuedCaseRun[] = [];
    const preparedEvals: PreparedEvalRun[] = [];
    const cacheMode: CacheMode = runState.manifest.cacheMode ?? 'use';
    const cacheEnabled = config.cache?.enabled !== false;
    const moduleIsolation = { key: runState.manifest.id, workspaceRoot };

    for (const evalMeta of targetEvals) {
      const evalFilePath = evalMeta.sourceFilePath;
      let codeFingerprint = '';
      try {
        const source = await readFile(evalFilePath, 'utf-8');
        codeFingerprint = getSourceFingerprint(source);
      } catch {
        codeFingerprint = '';
      }
      if (codeFingerprint.length > 0) {
        runState.manifest.evalSourceFingerprints[evalMeta.id] = codeFingerprint;
      } else {
        delete runState.manifest.evalSourceFingerprints[evalMeta.id];
      }

      try {
        const registry = getEvalRegistry();
        await runWithModuleIsolation(moduleIsolation, async () => {
          await loadEvalModule(evalFilePath, codeFingerprint);
        });

        const entry = registry.get(evalMeta.id);
        if (!entry) {
          evalErrors.push({
            evalId: evalMeta.id,
            message: `Eval "${evalMeta.id}" was not registered after importing ${evalFilePath}`,
          });
          continue;
        }

        await runWithModuleIsolation(moduleIsolation, async () => {
          await entry.use(async (evalDef) => {
            const cases = filterEvalCases(
              resolveRunnableEvalCases({
                cases:
                  typeof evalDef.cases === 'function'
                    ? await evalDef.cases()
                    : (evalDef.cases ?? []),
                evalId: evalMeta.id,
              }),
              request.target.evalIds,
              request.target.caseIds,
              evalMeta.id,
            );

            runState.summary.totalCases += cases.length;

            const accumulatedColumns = new Map<string, ColumnDef>();
            const evalCaseRows: CaseRow[] = [];
            const preparedCases: PreparedEvalCase[] = [];
            const scoreKeys = Object.freeze(Object.keys(evalDef.scores ?? {}));
            const manualScoreKeys = Object.freeze(
              Object.keys(evalDef.manualScores ?? {}),
            );
            const preparedEval: PreparedEvalRun = {
              evalMeta,
              accumulatedColumns,
              evalCaseRows,
              preparedCases,
              scoreKeys: Object.freeze([...scoreKeys, ...manualScoreKeys]),
              mergeColumns: (columns) => {
                mergeColumnDefs(
                  accumulatedColumns,
                  columns,
                  evalDef.columns,
                  evalDef.scores,
                  evalDef.manualScores,
                );
              },
            };
            preparedEvals.push(preparedEval);

            for (const evalCase of cases) {
              const trialResults: TrialExecutionResult[] = [];
              const preparedCase: PreparedEvalCase = {
                caseId: evalCase.id,
                trialResults,
                finalized: false,
              };
              preparedCases.push(preparedCase);

              for (let trial = 0; trial < request.trials; trial++) {
                const bufferedCacheStore =
                  cacheEnabled && cacheMode !== 'bypass'
                    ? createBufferedCacheStore(cacheStore)
                    : null;

                queuedCases.push({
                  execute: async ({ startTime, globalTraceDisplay }) => {
                    const { caseDetail, caseRowUpdate } = await runCase({
                      evalDef,
                      evalId: evalMeta.id,
                      evalCase,
                      globalTraceDisplay,
                      trial,
                      startTime,
                      cacheAdapter:
                        bufferedCacheStore ??
                        (cacheEnabled ? cacheStore : null),
                      cacheMode,
                      codeFingerprint,
                      moduleIsolation,
                      artifactDir: join(runDir, 'artifacts'),
                      runId: runState.manifest.id,
                    });

                    return {
                      caseDetail,
                      caseRow: {
                        caseId: evalCase.id,
                        evalId: evalMeta.id,
                        status: caseRowUpdate.status ?? 'pending',
                        latencyMs: caseRowUpdate.latencyMs ?? null,
                        columns: caseRowUpdate.columns ?? {},
                        trial,
                      },
                    };
                  },
                  onComplete: async ({ caseDetail, caseRow }) => {
                    trialResults.push({
                      caseDetail,
                      caseRow,
                      bufferedCacheStore,
                    });
                    if (trialResults.length !== request.trials) return;
                    await finalizePreparedCase({
                      runState,
                      runDir,
                      preparedEval,
                      preparedCase,
                      onCaseFinished,
                      emitEvent,
                    });
                  },
                });
              }
            }
          });
        });
      } catch (error) {
        console.error(`Error running eval ${evalMeta.id}:`, error);
        evalErrors.push({
          evalId: evalMeta.id,
          message: error instanceof Error ? error.message : String(error),
        });
        lastRunStatusMap.set(evalMeta.id, 'error');
        latestRunInfoMap.set(evalMeta.id, {
          status: 'error',
          startedAt: runState.manifest.endedAt ?? runState.manifest.startedAt,
          commitSha: runState.manifest.commitSha ?? null,
          evalSourceFingerprint:
            runState.manifest.evalSourceFingerprints[evalMeta.id] ?? null,
        });
      }
    }

    await executeQueuedCases({
      queuedCases,
      concurrency: getConfiguredConcurrency(),
      globalTraceDisplay: config.traceDisplay,
    });

    for (const preparedEval of preparedEvals) {
      for (const preparedCase of preparedEval.preparedCases) {
        await finalizePreparedCase({
          runState,
          runDir,
          preparedEval,
          preparedCase,
          onCaseFinished,
          emitEvent,
        });
      }

      preparedEval.evalMeta.columnDefs = [
        ...preparedEval.accumulatedColumns.values(),
      ];

      lastRunStatusMap.set(
        preparedEval.evalMeta.id,
        toLastRunStatus(
          deriveStatusFromCaseRows({ caseRows: preparedEval.evalCaseRows }),
        ),
      );
      const latestStatus =
        lastRunStatusMap.get(preparedEval.evalMeta.id) ?? null;
      latestRunInfoMap.set(preparedEval.evalMeta.id, {
        status: latestStatus,
        startedAt: runState.manifest.endedAt ?? runState.manifest.startedAt,
        commitSha: runState.manifest.commitSha ?? null,
        evalSourceFingerprint:
          runState.manifest.evalSourceFingerprints[preparedEval.evalMeta.id] ??
          null,
      });
    }

    sortCaseRowsByPreparedOrder(runState.cases, preparedEvals);
    for (const preparedEval of preparedEvals) {
      sortCaseRowsByPreparedOrder(preparedEval.evalCaseRows, preparedEvals);
    }

    const endTime = new Date();
    runState.summary.totalDurationMs =
      endTime.getTime() - new Date(runState.manifest.startedAt).getTime();

    const finalStatus = evalErrors.length > 0 ? 'error' : 'completed';
    runState.summary.status = finalStatus;
    runState.manifest.status = finalStatus;
    const completedRunAt = endTime.toISOString();
    runState.manifest.endedAt = completedRunAt;
    runState.summary.errorMessage =
      evalErrors.length > 0
        ? evalErrors
            .map((entry) => `[${entry.evalId}] ${entry.message}`)
            .join('\n')
        : null;

    for (const evalId of getTargetEvalIds({
      request,
      sortedEvalIds: getSortedEvalMetas().map((meta) => meta.id),
      knownEvalIds: new Set(evals.keys()),
    })) {
      const latestStatus =
        lastRunStatusMap.get(evalId) ??
        toLastRunStatus(
          deriveStatusFromCaseRows({
            caseRows: [],
            lifecycleStatus: runState.manifest.status,
          }),
        );
      latestRunInfoMap.set(evalId, {
        status: latestStatus,
        startedAt: completedRunAt,
        commitSha: runState.manifest.commitSha ?? null,
        evalSourceFingerprint:
          runState.manifest.evalSourceFingerprints[evalId] ?? null,
      });
    }

    await persistRunState(runState);

    emitEvent(runState, {
      type: 'run.summary',
      runId: runState.manifest.id,
      timestamp: new Date().toISOString(),
      payload: runState.summary,
    });

    if (finalStatus === 'error') {
      emitEvent(runState, {
        type: 'run.error',
        runId: runState.manifest.id,
        timestamp: new Date().toISOString(),
        payload: {
          message: evalErrors
            .map((entry) => `[${entry.evalId}] ${entry.message}`)
            .join('\n'),
        },
      });
    } else {
      emitEvent(runState, {
        type: 'run.finished',
        runId: runState.manifest.id,
        timestamp: new Date().toISOString(),
        payload: runState.summary,
      });
    }

    emitDiscoveryEvent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runState.manifest.status = 'error';
    runState.manifest.endedAt = new Date().toISOString();
    runState.summary.status = 'error';
    runState.summary.errorMessage = message;

    await persistRunState(runState);

    emitEvent(runState, {
      type: 'run.error',
      runId: runState.manifest.id,
      timestamp: new Date().toISOString(),
      payload: { message },
    });

    emitDiscoveryEvent();
  }
}

function toLastRunStatus(
  status: ReturnType<typeof deriveStatusFromCaseRows>,
): EvalSummary['lastRunStatus'] {
  return status === 'pending' ? null : status;
}
