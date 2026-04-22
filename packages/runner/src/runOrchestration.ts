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
  EvalSummary,
  RunManifest,
  RunSummary,
  SseEnvelope,
  TrialSelectionMode,
} from '@agent-evals/shared';
import {
  deriveScopedSummaryFromCases,
  deriveStatusFromCaseRows,
} from '@agent-evals/shared';
import {
  createBufferedCacheStore,
  type BufferedCacheStore,
  type FsCacheStore,
} from './cacheStore.ts';
import { mergeColumnDefs } from './columnBuilder.ts';
import { loadEvalModule } from './evalModuleLoader.ts';
import { getTargetEvalIds } from './evalSummaries.ts';
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
};

export type RunState = {
  runDir: string;
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
  caseDetails: Map<string, CaseDetail>;
  listeners: Set<(event: SseEnvelope) => void>;
  abortController: AbortController;
};

type TrialExecutionResult = {
  caseDetail: CaseDetail;
  caseRow: CaseRow;
  bufferedCacheStore: BufferedCacheStore | null;
};

type PreparedEvalCase = {
  caseId: string;
  trialResults: TrialExecutionResult[];
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
  getSourceFingerprint: (source: string) => string;
  getConfiguredConcurrency: () => number;
  getSortedEvalMetas: () => EvalMeta[];
  getTargetEvals: (request: CreateRunRequest) => EvalMeta[];
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
  getSourceFingerprint,
  getConfiguredConcurrency,
  getSortedEvalMetas,
  getTargetEvals,
}: ExecuteRunParams): Promise<void> {
  try {
    const targetEvals = getTargetEvals(request);

    emitEvent(runState, {
      type: 'run.started',
      runId: runState.manifest.id,
      timestamp: new Date().toISOString(),
      payload: runState.manifest,
    });

    const allCaseRows: CaseRow[] = [];
    const evalErrors: { evalId: string; message: string }[] = [];
    const queuedCases: QueuedCaseRun[] = [];
    const preparedEvals: PreparedEvalRun[] = [];
    const cacheMode: CacheMode = runState.manifest.cacheMode ?? 'use';
    const cacheEnabled = config.cache?.enabled !== false;

    for (const evalMeta of targetEvals) {
      if (runState.abortController.signal.aborted) break;

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
        await loadEvalModule(evalFilePath, codeFingerprint);

        const entry = registry.get(evalMeta.id);
        if (!entry) {
          evalErrors.push({
            evalId: evalMeta.id,
            message: `Eval "${evalMeta.id}" was not registered after importing ${evalFilePath}`,
          });
          continue;
        }

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
          preparedEvals.push({
            evalMeta,
            accumulatedColumns,
            evalCaseRows,
            preparedCases,
            scoreKeys,
            mergeColumns: (columns) => {
              mergeColumnDefs(
                accumulatedColumns,
                columns,
                evalDef.columns,
                evalDef.scores,
              );
            },
          });

          for (const evalCase of cases) {
            if (runState.abortController.signal.aborted) break;

            const trialResults: TrialExecutionResult[] = [];
            preparedCases.push({ caseId: evalCase.id, trialResults });

            for (let trial = 0; trial < request.trials; trial++) {
              const bufferedCacheStore =
                cacheEnabled && cacheMode !== 'bypass'
                  ? createBufferedCacheStore(cacheStore)
                  : null;

              queuedCases.push({
                execute: async ({ startTime, signal, globalTraceDisplay }) => {
                  const { caseDetail, caseRowUpdate } = await runCase({
                    evalDef,
                    evalId: evalMeta.id,
                    evalCase,
                    globalTraceDisplay,
                    trial,
                    signal,
                    startTime,
                    cacheAdapter:
                      bufferedCacheStore ?? (cacheEnabled ? cacheStore : null),
                    cacheMode,
                    codeFingerprint,
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
                      costUsd: caseRowUpdate.costUsd ?? null,
                      columns: caseRowUpdate.columns ?? {},
                      trial,
                    },
                  };
                },
                onComplete: ({ caseDetail, caseRow }) => {
                  trialResults.push({
                    caseDetail,
                    caseRow,
                    bufferedCacheStore,
                  });
                },
              });
            }
          }
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
      runState,
      queuedCases,
      concurrency: getConfiguredConcurrency(),
      globalTraceDisplay: config.traceDisplay,
    });

    for (const preparedEval of preparedEvals) {
      for (const preparedCase of preparedEval.preparedCases) {
        if (preparedCase.trialResults.length === 0) {
          continue;
        }

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

        emitEvent(runState, {
          type: 'case.finished',
          runId: runState.manifest.id,
          timestamp: new Date().toISOString(),
          payload: winningTrial.caseRow,
        });

        preparedEval.evalCaseRows.push(winningTrial.caseRow);
        allCaseRows.push(winningTrial.caseRow);
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

    const derivedRunSummary = deriveScopedSummaryFromCases({
      caseRows: allCaseRows,
    });
    runState.summary.cost = derivedRunSummary.cost;

    const endTime = new Date();
    runState.summary.totalDurationMs =
      endTime.getTime() - new Date(runState.manifest.startedAt).getTime();

    const finalStatus = runState.abortController.signal.aborted
      ? 'cancelled'
      : evalErrors.length > 0
        ? 'error'
        : 'completed';
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

    await persistRunState(runState);
    emitDiscoveryEvent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runState.manifest.status = 'error';
    runState.manifest.endedAt = new Date().toISOString();
    runState.summary.status = 'error';
    runState.summary.errorMessage = message;

    emitEvent(runState, {
      type: 'run.error',
      runId: runState.manifest.id,
      timestamp: new Date().toISOString(),
      payload: { message },
    });

    await persistRunState(runState);
    emitDiscoveryEvent();
  }
}

function toLastRunStatus(
  status: ReturnType<typeof deriveStatusFromCaseRows>,
): EvalSummary['lastRunStatus'] {
  return status === 'pending' ? null : status;
}
