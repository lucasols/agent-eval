import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { getEvalRegistry } from '@agent-evals/sdk';
import type {
  EvalSummary,
  RunManifest,
  RunSummary,
  CaseRow,
  CaseDetail,
  SseEnvelope,
  CreateRunRequest,
  AgentEvalsConfig,
  CacheListItem,
  CacheMode,
  ColumnDef,
  TrialSelectionMode,
} from '@agent-evals/shared';
import {
  deriveStatusFromCaseRows,
  deriveScopedSummaryFromCases,
} from '@agent-evals/shared';
import { watch } from 'chokidar';
import { glob } from 'glob';
import {
  createBufferedCacheStore,
  createFsCacheStore,
  type CacheClearFilter,
  type BufferedCacheStore,
  type FsCacheStore,
} from './cacheStore.ts';
import { mergeColumnDefs, normalizeScoreDef } from './columnBuilder.ts';
import { loadConfig } from './config.ts';
import { parseEvalMetas } from './discovery.ts';
import {
  buildEvalSummary,
  getTargetEvalIds,
  setLatestRunInfoMap,
} from './evalSummaries.ts';
import { readGitWorktreeState } from './gitState.ts';
import { filterEvalCases, runCase } from './runExecution.ts';
import { executeQueuedCases, type QueuedCaseRun } from './runQueue.ts';
import {
  persistRunState,
  recomputeEvalStatusesInRuns,
  runTouchesEval,
} from './runMaintenance.ts';
import {
  generateRunId,
  getLastRunStatuses,
  getLatestRunInfos,
  loadPersistedRunSnapshots,
  nextShortIdFromSnapshots,
  persistCaseDetail,
  type EvalLatestRunInfo,
} from './runPersistence.ts';

/** Imperative runner interface used by the server and CLI. */
export type EvalRunner = {
  /** Load workspace config, discover evals, and start file watching when enabled. */
  init(): Promise<void>;
  /** Return the currently discovered eval summaries for the active workspace. */
  getEvals(): EvalSummary[];
  /** Look up one discovered eval by id. */
  getEval(id: string): EvalSummary | undefined;
  /** Re-scan configured eval files and emit a discovery update to listeners. */
  refreshDiscovery(): Promise<void>;
  startRun(
    request: CreateRunRequest,
  ): Promise<{ manifest: RunManifest; summary: RunSummary; cases: CaseRow[] }>;
  /** Return run manifests tracked in memory, including persisted runs loaded during init. */
  getRuns(): RunManifest[];
  /** Return one run with its summary and case rows when available in memory. */
  getRun(
    id: string,
  ):
    | { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] }
    | undefined;
  /** Request cancellation for an in-flight run. */
  cancelRun(id: string): void;
  /** Return full details for a single case in a run, when available. */
  getCaseDetail(runId: string, caseId: string): CaseDetail | undefined;
  /** Subscribe to streamed events for a specific run. */
  subscribe(runId: string, listener: (event: SseEnvelope) => void): () => void;
  /** Subscribe to discovery updates triggered by file changes or manual refresh. */
  subscribeDiscovery(listener: (event: SseEnvelope) => void): () => void;
  /** Resolve the workspace root backing this runner instance. */
  getWorkspaceRoot(): string;
  /** Resolve a persisted artifact path when artifact storage is supported. */
  getArtifactPath(artifactId: string): string | undefined;
  /** Return summaries for every persisted cache entry in the workspace. */
  listCache(): Promise<CacheListItem[]>;
  /**
   * Remove cache entries matching `filter`, or all entries when no filter is
   * supplied.
   */
  clearCache(filter?: CacheClearFilter): Promise<void>;
  /** Recompute persisted case and run statuses for terminal runs touching one eval. */
  recomputeStatusesForEval(evalId: string): Promise<{ updatedRuns: number }>;
  /** Delete terminal persisted runs that touch one eval from in-memory history and disk. */
  cleanRunsForEval(evalId: string): Promise<{ deletedRuns: number }>;
  /**
   * Delete one persisted run from in-memory history and disk.
   *
   * Ignored for in-flight runs — cancel first, then delete.
   * Returns `deleted: false` when the run is missing or still running.
   */
  deleteRun(runId: string): Promise<{ deleted: boolean }>;
};

type CreateRunnerOptions = { watchForChanges?: boolean };

type EvalMeta = {
  id: string;
  title?: string;
  description?: string;
  filePath: string;
  sourceFilePath: string;
  sourceFingerprint: string | null;
  columnDefs: ColumnDef[];
  passThreshold: number;
  caseCount: number | null;
};

type RunState = {
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

function toComparableTrialScore(score: number | null): number {
  return score ?? Number.NEGATIVE_INFINITY;
}

function compareTrialResults(
  left: TrialExecutionResult,
  right: TrialExecutionResult,
): number {
  const scoreDiff =
    toComparableTrialScore(left.caseRow.score) -
    toComparableTrialScore(right.caseRow.score);
  if (scoreDiff !== 0) return scoreDiff;
  return left.caseRow.trial - right.caseRow.trial;
}

function pickWinningTrial(params: {
  strategy: TrialSelectionMode;
  attempts: TrialExecutionResult[];
}): TrialExecutionResult {
  const orderedAttempts = [...params.attempts].toSorted(compareTrialResults);
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

type PreparedEvalCase = {
  caseId: string;
  trialResults: TrialExecutionResult[];
};

type PreparedEvalRun = {
  evalMeta: EvalMeta;
  accumulatedColumns: Map<string, ColumnDef>;
  evalCaseRows: CaseRow[];
  preparedCases: PreparedEvalCase[];
  mergeColumns: (columns: CaseDetail['columns']) => void;
};
/** Create an in-memory eval runner bound to the current workspace config. */
export function createRunner({
  watchForChanges = true,
}: CreateRunnerOptions = {}): EvalRunner {
  let config: AgentEvalsConfig;
  let workspaceRoot: string;
  let localStateDir: string;
  let cacheStore: FsCacheStore;
  const evals = new Map<string, EvalMeta>();
  const runs = new Map<string, RunState>();
  const lastRunStatusMap = new Map<string, EvalSummary['lastRunStatus']>();
  const latestRunInfoMap = new Map<string, EvalLatestRunInfo>();
  const discoveryListeners = new Set<(event: SseEnvelope) => void>();
  let nextShortIdNum = 0;

  function toWorkspaceRelativePath(filePath: string): string {
    return relative(workspaceRoot, filePath).replaceAll('\\', '/');
  }

  function getSortedEvalMetas(): EvalMeta[] {
    return [...evals.values()].toSorted((a, b) =>
      a.filePath.localeCompare(b.filePath),
    );
  }

  function toLastRunStatus(
    status: ReturnType<typeof deriveStatusFromCaseRows>,
  ): EvalSummary['lastRunStatus'] {
    return status === 'pending' ? null : status;
  }

  function getSourceFingerprint(source: string): string {
    return createHash('sha256').update(source).digest('hex');
  }

  function getConfiguredConcurrency(): number {
    const configuredConcurrency = config.concurrency;
    if (
      typeof configuredConcurrency !== 'number' ||
      !Number.isFinite(configuredConcurrency)
    ) {
      return 1;
    }

    return Math.max(1, Math.floor(configuredConcurrency));
  }

  const runner: EvalRunner = {
    async init() {
      config = await loadConfig();
      workspaceRoot = config.workspaceRoot ?? process.cwd();
      localStateDir = resolve(workspaceRoot, '.agent-evals');

      await mkdir(localStateDir, { recursive: true });
      await mkdir(join(localStateDir, 'runs'), { recursive: true });

      cacheStore = createFsCacheStore({
        workspaceRoot,
        dir: config.cache?.dir,
      });

      await loadPersistedRuns();
      await runner.refreshDiscovery();
      if (watchForChanges) {
        setupWatcher();
      }
    },
    async listCache() {
      return cacheStore.list();
    },
    async clearCache(filter) {
      await cacheStore.clear(filter);
    },
    async recomputeStatusesForEval(evalId) {
      const evalMeta = evals.get(evalId);
      if (!evalMeta) return { updatedRuns: 0 };

      const registry = getEvalRegistry();
      await import(evalMeta.sourceFilePath);
      const entry = registry.get(evalId);
      if (!entry) return { updatedRuns: 0 };

      const scoreThresholds = new Map<string, number>();
      entry.use((evalDef) => {
        for (const [key, def] of Object.entries(evalDef.scores ?? {})) {
          scoreThresholds.set(key, normalizeScoreDef(def).passThreshold ?? 0.5);
        }
      });

      const updatedRuns = await recomputeEvalStatusesInRuns({
        runs: runs.values(),
        evalId,
        evalExists: evals.has(evalId),
        scoreThresholds,
        persistCaseDetail,
      });

      emitDiscoveryEvent();
      return { updatedRuns };
    },
    async cleanRunsForEval(evalId) {
      let deletedRuns = 0;
      for (const [runId, run] of [...runs]) {
        if (
          !runTouchesEval({
            target: run.manifest.target,
            caseRows: run.cases,
            evalId,
            evalExists: evals.has(evalId),
          })
        ) {
          continue;
        }
        if (run.manifest.status === 'running') continue;

        runs.delete(runId);
        await rm(run.runDir, { recursive: true, force: true });
        deletedRuns += 1;
      }

      emitDiscoveryEvent();
      return { deletedRuns };
    },
    async deleteRun(runId) {
      const run = runs.get(runId);
      if (!run) return { deleted: false };
      if (run.manifest.status === 'running') return { deleted: false };

      runs.delete(runId);
      await rm(run.runDir, { recursive: true, force: true });

      emitDiscoveryEvent();
      return { deleted: true };
    },
    getEvals() {
      const gitState = readGitWorktreeState(workspaceRoot);
      const result: EvalSummary[] = [];
      for (const meta of getSortedEvalMetas()) {
        result.push(
          buildEvalSummary({
            meta,
            config,
            gitState,
            latestRun: latestRunInfoMap.get(meta.id),
            lastRunStatus: lastRunStatusMap.get(meta.id) ?? null,
          }),
        );
      }
      return result;
    },
    getEval(id) {
      const meta = evals.get(id);
      if (!meta) return undefined;
      return buildEvalSummary({
        meta,
        config,
        gitState: readGitWorktreeState(workspaceRoot),
        latestRun: latestRunInfoMap.get(meta.id),
        lastRunStatus: lastRunStatusMap.get(meta.id) ?? null,
      });
    },
    async refreshDiscovery() {
      const patterns = config.include;
      const discovered: string[] = [];

      for (const pattern of patterns) {
        const files = await glob(pattern, {
          cwd: workspaceRoot,
          absolute: true,
        });
        discovered.push(...files);
      }

      evals.clear();
      for (const filePath of discovered) {
        try {
          const content = await readFile(filePath, 'utf-8');
          const discoveredMetas = parseEvalMetas(filePath, content);
          for (const meta of discoveredMetas) {
            evals.set(meta.id, {
              id: meta.id,
              title: meta.title,
              filePath: toWorkspaceRelativePath(meta.filePath),
              sourceFilePath: meta.filePath,
              sourceFingerprint: getSourceFingerprint(content),
              columnDefs: [],
              passThreshold: meta.passThreshold,
              caseCount: null,
            });
          }
        } catch {
          // skip files that can't be parsed
        }
      }

      emitDiscoveryEvent();
    },
    async startRun(request) {
      const runId = generateRunId();
      const shortId = `r${String(nextShortIdNum++)}`;
      const now = new Date().toISOString();
      const cacheMode: CacheMode = request.cache?.mode ?? 'use';
      const runDir = join(localStateDir, 'runs', runId);
      const gitState = readGitWorktreeState(workspaceRoot);

      const manifest: RunManifest = {
        id: runId,
        shortId,
        status: 'running',
        startedAt: now,
        endedAt: null,
        commitSha: gitState.commitSha,
        evalSourceFingerprints: {},
        target: request.target,
        trials: request.trials,
        trialSelection: config.trialSelection ?? 'lowestScore',
        cacheMode,
      };

      const summary: RunSummary = {
        runId,
        status: 'running',
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
        errorCases: 0,
        cancelledCases: 0,
        averageScore: null,
        totalDurationMs: null,
        cost: { totalUsd: null },
        errorMessage: null,
      };

      const abortController = new AbortController();

      const runState: RunState = {
        runDir,
        manifest,
        summary,
        cases: [],
        caseDetails: new Map(),
        listeners: new Set(),
        abortController,
      };

      runs.set(runId, runState);
      setLatestRunInfoMap({
        latestRunInfoMap,
        evalIds: getTargetEvalIds({
          request,
          sortedEvalIds: getSortedEvalMetas().map((meta) => meta.id),
          knownEvalIds: new Set(evals.keys()),
        }),
        info: {
          status: 'running',
          startedAt: now,
          commitSha: manifest.commitSha ?? null,
          evalSourceFingerprint: null,
        },
      });

      await mkdir(runDir, { recursive: true });
      await mkdir(join(runDir, 'traces'), { recursive: true });
      await mkdir(join(runDir, 'artifacts'), { recursive: true });
      await mkdir(join(runDir, 'case-details'), { recursive: true });

      await writeFile(
        join(runDir, 'run.json'),
        JSON.stringify(manifest, null, 2),
      );

      void executeRun(runState, request, runDir);

      return { manifest, summary, cases: [] };
    },
    getRuns() {
      return [...runs.values()].map((r) => r.manifest);
    },
    getRun(id) {
      const run = runs.get(id);
      if (!run) return undefined;
      return { manifest: run.manifest, summary: run.summary, cases: run.cases };
    },
    cancelRun(id) {
      const run = runs.get(id);
      if (!run) return;
      run.abortController.abort();
      run.manifest.status = 'cancelled';
      run.manifest.endedAt = new Date().toISOString();
      run.summary.status = 'cancelled';
      emitEvent(run, {
        type: 'run.cancelled',
        runId: id,
        timestamp: new Date().toISOString(),
        payload: run.summary,
      });
    },
    getCaseDetail(runId, caseId) {
      const run = runs.get(runId);
      if (!run) return undefined;
      return run.caseDetails.get(caseId);
    },
    subscribe(runId, listener) {
      const run = runs.get(runId);
      if (!run) return () => {};
      run.listeners.add(listener);
      return () => {
        run.listeners.delete(listener);
      };
    },

    subscribeDiscovery(listener) {
      discoveryListeners.add(listener);
      return () => {
        discoveryListeners.delete(listener);
      };
    },

    getWorkspaceRoot() {
      return workspaceRoot;
    },

    getArtifactPath(artifactId_) {
      return undefined;
    },
  };

  function setupWatcher() {
    const patterns = config.include.map((p) => resolve(workspaceRoot, p));
    const watcher = watch(patterns, { ignoreInitial: true, persistent: true });

    watcher.on('change', () => {
      void runner.refreshDiscovery();
    });

    watcher.on('add', () => {
      void runner.refreshDiscovery();
    });

    watcher.on('unlink', () => {
      void runner.refreshDiscovery();
    });
  }

  function emitDiscoveryEvent() {
    const lastRunStatuses = getLastRunStatuses({
      runs: runs.values(),
      knownEvalIds: evals.keys(),
    });
    const latestRunInfos = getLatestRunInfos({
      runs: runs.values(),
      knownEvalIds: evals.keys(),
    });
    lastRunStatusMap.clear();
    for (const [evalId, status] of lastRunStatuses) {
      lastRunStatusMap.set(evalId, status);
    }
    latestRunInfoMap.clear();
    for (const [evalId, info] of latestRunInfos) {
      latestRunInfoMap.set(evalId, info);
    }
    const event: SseEnvelope = {
      type: 'discovery.updated',
      timestamp: new Date().toISOString(),
      payload: runner.getEvals(),
    };
    for (const listener of discoveryListeners) {
      listener(event);
    }
  }

  async function executeRun(
    runState: RunState,
    request: CreateRunRequest,
    runDir: string,
  ) {
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
          runState.manifest.evalSourceFingerprints[evalMeta.id] =
            codeFingerprint;
        } else {
          delete runState.manifest.evalSourceFingerprints[evalMeta.id];
        }

        try {
          const registry = getEvalRegistry();
          await import(evalFilePath);

          const entry = registry.get(evalMeta.id);
          if (!entry) {
            evalErrors.push({
              evalId: evalMeta.id,
              message: `Eval "${evalMeta.id}" was not registered after importing ${evalFilePath}`,
            });
            continue;
          }

          await entry.use(async (evalDef) => {
            evalMeta.passThreshold = evalDef.passThreshold ?? 0.5;
            const cases = filterEvalCases(
              typeof evalDef.cases === 'function'
                ? await evalDef.cases()
                : (evalDef.cases ?? []),
              request.target.evalIds,
              request.target.caseIds,
              evalMeta.id,
            );

            runState.summary.totalCases += cases.length;

            const accumulatedColumns = new Map<string, ColumnDef>();
            const evalCaseRows: CaseRow[] = [];
            const preparedCases: PreparedEvalCase[] = [];
            preparedEvals.push({
              evalMeta,
              accumulatedColumns,
              evalCaseRows,
              preparedCases,
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
              preparedCases.push({
                caseId: evalCase.id,
                trialResults,
              });

              for (let trial = 0; trial < request.trials; trial++) {
                const bufferedCacheStore =
                  cacheEnabled && cacheMode !== 'bypass'
                    ? createBufferedCacheStore(cacheStore)
                    : null;

                queuedCases.push({
                  execute: async ({
                    startTime,
                    signal,
                    globalTraceDisplay,
                  }) => {
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
                    });

                    return {
                      caseDetail,
                      caseRow: {
                        caseId: evalCase.id,
                        evalId: evalMeta.id,
                        status: caseRowUpdate.status ?? 'pending',
                        score: caseRowUpdate.score ?? null,
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
            runState.manifest.evalSourceFingerprints[
              preparedEval.evalMeta.id
            ] ?? null,
        });
      }

      const derivedRunSummary = deriveScopedSummaryFromCases({
        caseRows: allCaseRows,
      });
      runState.summary.averageScore = derivedRunSummary.averageScore;
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
          ? evalErrors.map((e) => `[${e.evalId}] ${e.message}`).join('\n')
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
              .map((e) => `[${e.evalId}] ${e.message}`)
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

  function getTargetEvals(request: CreateRunRequest): EvalMeta[] {
    if (request.target.evalIds && request.target.evalIds.length > 0) {
      return request.target.evalIds
        .map((id) => evals.get(id))
        .filter((e): e is EvalMeta => e !== undefined);
    }
    return getSortedEvalMetas();
  }

  function emitEvent(runState: RunState, event: SseEnvelope) {
    for (const listener of runState.listeners) {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  async function loadPersistedRuns(): Promise<void> {
    runs.clear();
    const persistedRuns = await loadPersistedRunSnapshots(localStateDir);
    nextShortIdNum = nextShortIdFromSnapshots(persistedRuns);

    for (const persistedRun of persistedRuns) {
      runs.set(persistedRun.manifest.id, {
        ...persistedRun,
        listeners: new Set(),
        abortController: new AbortController(),
      });
    }
  }

  return runner;
}
