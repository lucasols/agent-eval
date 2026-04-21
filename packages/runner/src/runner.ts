import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import {
  getEvalRegistry,
  runInEvalScope,
  buildTraceTree,
  EvalAssertionError,
  type EvalDefinition,
} from '@agent-evals/sdk';
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
  CellValue,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import {
  deriveStatusFromCaseRows,
  deriveScopedSummaryFromCases,
} from '@agent-evals/shared';
import { watch } from 'chokidar';
import { glob } from 'glob';
import {
  createFsCacheStore,
  type CacheClearFilter,
  type FsCacheStore,
} from './cacheStore.ts';
import {
  mergeColumnDefs,
  normalizeScoreDef,
  toCellValue,
} from './columnBuilder.ts';
import { loadConfig } from './config.ts';
import { parseEvalMetas } from './discovery.ts';
import {
  persistRunState,
  recomputeEvalStatusesInRuns,
  runTouchesEval,
} from './runMaintenance.ts';
import {
  generateRunId,
  getLastRunStatuses,
  loadPersistedRunSnapshots,
  nextShortIdFromSnapshots,
  persistCaseDetail,
} from './runPersistence.ts';
import { resolveTracePresentation } from './traceDisplay.ts';

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
};

type CreateRunnerOptions = { watchForChanges?: boolean };

type EvalMeta = {
  id: string;
  title?: string;
  description?: string;
  filePath: string;
  sourceFilePath: string;
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

/** Create an in-memory eval runner bound to the current workspace config. */
export function createRunner({
  watchForChanges = true,
}: CreateRunnerOptions = {}): EvalRunner {
  let config: AgentEvalsConfig;
  let workspaceRoot: string;
  let localStateDir: string;
  let cacheStore: FsCacheStore;
  const evals = new Map<string, EvalMeta>();
  const staleEvals = new Set<string>();
  const runs = new Map<string, RunState>();
  const lastRunStatusMap = new Map<string, EvalSummary['lastRunStatus']>();
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
    getEvals() {
      const result: EvalSummary[] = [];
      for (const meta of getSortedEvalMetas()) {
        result.push({
          id: meta.id,
          title: meta.title,
          description: meta.description,
          filePath: meta.filePath,
          stale: staleEvals.has(meta.id),
          columnDefs: meta.columnDefs,
          passThreshold: meta.passThreshold,
          caseCount: meta.caseCount,
          lastRunStatus: lastRunStatusMap.get(meta.id) ?? null,
        });
      }
      return result;
    },
    getEval(id) {
      const meta = evals.get(id);
      if (!meta) return undefined;
      return {
        id: meta.id,
        title: meta.title,
        description: meta.description,
        filePath: meta.filePath,
        stale: staleEvals.has(meta.id),
        columnDefs: meta.columnDefs,
        passThreshold: meta.passThreshold,
        caseCount: meta.caseCount,
        lastRunStatus: lastRunStatusMap.get(meta.id) ?? null,
      };
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
      staleEvals.clear();

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

      const manifest: RunManifest = {
        id: runId,
        shortId,
        status: 'running',
        startedAt: now,
        endedAt: null,
        target: request.target,
        trials: request.trials,
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
    lastRunStatusMap.clear();
    for (const [evalId, status] of lastRunStatuses) {
      lastRunStatusMap.set(evalId, status);
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
      const cacheMode: CacheMode = runState.manifest.cacheMode ?? 'use';
      const cacheEnabled = config.cache?.enabled !== false;

      for (const evalMeta of targetEvals) {
        if (runState.abortController.signal.aborted) break;

        const evalFilePath = evalMeta.sourceFilePath;
        let codeFingerprint = '';
        try {
          const source = await readFile(evalFilePath, 'utf-8');
          codeFingerprint = createHash('sha256').update(source).digest('hex');
        } catch {
          codeFingerprint = '';
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

            runState.summary.totalCases += cases.length * request.trials;

            const accumulatedColumns = new Map<string, ColumnDef>();
            const evalCaseRows: CaseRow[] = [];

            for (let trial = 0; trial < request.trials; trial++) {
              for (const evalCase of cases) {
                if (runState.abortController.signal.aborted) break;

                const caseRow: CaseRow = {
                  caseId: evalCase.id,
                  evalId: evalMeta.id,
                  status: 'running',
                  score: null,
                  latencyMs: null,
                  costUsd: null,
                  columns: {},
                  trial,
                };

                runState.cases.push(caseRow);

                emitEvent(runState, {
                  type: 'case.started',
                  runId: runState.manifest.id,
                  timestamp: new Date().toISOString(),
                  payload: caseRow,
                });

                const startTime = Date.now();

                const { caseDetail, caseRowUpdate } = await runCase({
                  evalDef,
                  evalId: evalMeta.id,
                  evalCase,
                  globalTraceDisplay: config.traceDisplay,
                  trial,
                  signal: runState.abortController.signal,
                  startTime,
                  cacheAdapter: cacheEnabled ? cacheStore : null,
                  cacheMode,
                  codeFingerprint,
                });

                Object.assign(caseRow, caseRowUpdate);
                runState.caseDetails.set(evalCase.id, caseDetail);

                mergeColumnDefs(
                  accumulatedColumns,
                  caseDetail.columns,
                  evalDef.columns,
                  evalDef.scores,
                );

                if (caseRow.status === 'pass') {
                  runState.summary.passedCases++;
                } else if (caseRow.status === 'error') {
                  runState.summary.errorCases++;
                } else {
                  runState.summary.failedCases++;
                }

                await writeFile(
                  join(runDir, 'traces', `${evalCase.id}.json`),
                  JSON.stringify(caseDetail.trace, null, 2),
                );
                await persistCaseDetail(runDir, caseDetail);

                emitEvent(runState, {
                  type: 'case.finished',
                  runId: runState.manifest.id,
                  timestamp: new Date().toISOString(),
                  payload: caseRow,
                });

                evalCaseRows.push(caseRow);
                allCaseRows.push(caseRow);
              }
            }

            evalMeta.columnDefs = [...accumulatedColumns.values()];

            lastRunStatusMap.set(
              evalMeta.id,
              toLastRunStatus(
                deriveStatusFromCaseRows({ caseRows: evalCaseRows }),
              ),
            );
          });
        } catch (error) {
          console.error(`Error running eval ${evalMeta.id}:`, error);
          evalErrors.push({
            evalId: evalMeta.id,
            message: error instanceof Error ? error.message : String(error),
          });
          lastRunStatusMap.set(evalMeta.id, 'error');
        }
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
      runState.manifest.endedAt = endTime.toISOString();
      runState.summary.errorMessage =
        evalErrors.length > 0
          ? evalErrors.map((e) => `[${e.evalId}] ${e.message}`).join('\n')
          : null;

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

function filterEvalCases<TInput>(
  cases: { id: string; input: TInput; tags?: string[] }[],
  evalIds: string[] | undefined,
  caseIds: string[] | undefined,
  evalId: string,
): { id: string; input: TInput; tags?: string[] }[] {
  if (evalIds && evalIds.length > 0 && !evalIds.includes(evalId)) {
    return [];
  }

  if (!caseIds || caseIds.length === 0) {
    return cases;
  }

  const selectedCaseIds = new Set(caseIds);
  return cases.filter((evalCase) => selectedCaseIds.has(evalCase.id));
}

async function runCase<TInput>(params: {
  evalDef: EvalDefinition<TInput>;
  evalId: string;
  evalCase: { id: string; input: TInput; tags?: string[] };
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
  trial: number;
  signal: AbortSignal;
  startTime: number;
  cacheAdapter: FsCacheStore | null;
  cacheMode: CacheMode;
  codeFingerprint: string;
}): Promise<{ caseDetail: CaseDetail; caseRowUpdate: Partial<CaseRow> }> {
  const {
    evalDef,
    evalId,
    evalCase,
    globalTraceDisplay,
    trial,
    signal,
    startTime,
    cacheAdapter,
    cacheMode,
    codeFingerprint,
  } = params;

  const { scope, error: executeError } = await runInEvalScope(
    evalCase.id,
    async () => {
      await evalDef.execute({ input: evalCase.input, signal });
    },
    {
      cacheContext: cacheAdapter
        ? { adapter: cacheAdapter, mode: cacheMode, evalId, codeFingerprint }
        : undefined,
    },
  );

  const elapsedMs = Date.now() - startTime;
  const traceTree = buildTraceTree(scope.spans, scope.checkpoints);

  const nonAssertError =
    executeError && !(executeError instanceof EvalAssertionError)
      ? executeError
      : null;

  if (!nonAssertError && evalDef.deriveFromTracing) {
    try {
      const derived = await evalDef.deriveFromTracing({
        trace: traceTree,
        input: evalCase.input,
        case: evalCase,
      });
      for (const [key, value] of Object.entries(derived)) {
        if (!(key in scope.outputs)) {
          scope.outputs[key] = value;
        }
      }
    } catch (e) {
      scope.assertionFailures.push(
        `deriveFromTracing threw: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const scoreResults = new Map<
    string,
    {
      value: number;
      passThreshold: number | undefined;
      label: string | undefined;
    }
  >();

  if (!nonAssertError && evalDef.scores) {
    for (const [key, def] of Object.entries(evalDef.scores)) {
      const { compute, passThreshold, label } = normalizeScoreDef(def);
      try {
        const value = await compute({
          input: evalCase.input,
          outputs: scope.outputs,
          case: evalCase,
        });
        scope.outputs[key] = value;
        scoreResults.set(key, { value, passThreshold, label });
      } catch (e) {
        scope.assertionFailures.push(
          `score "${key}" threw: ${e instanceof Error ? e.message : String(e)}`,
        );
        scope.outputs[key] = 0;
        scoreResults.set(key, { value: 0, passThreshold, label });
      }
    }
  }

  const scoreValues = [...scoreResults.values()].map((s) => s.value);
  const avgScore =
    scoreValues.length > 0
      ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
      : null;
  const casePassThreshold = evalDef.passThreshold ?? 0.5;

  let passed = scope.assertionFailures.length === 0 && !nonAssertError;
  if (passed) {
    for (const [, scoreEntry] of scoreResults) {
      if (
        scoreEntry.passThreshold !== undefined &&
        scoreEntry.value < scoreEntry.passThreshold
      ) {
        passed = false;
        break;
      }
    }
  }
  if (passed && avgScore !== null && avgScore < casePassThreshold) {
    passed = false;
  }

  const status: CaseRow['status'] = nonAssertError
    ? 'error'
    : passed
      ? 'pass'
      : 'fail';

  const { trace: displayTrace, traceDisplay } = resolveTracePresentation(
    scope.spans,
    globalTraceDisplay,
    evalDef.traceDisplay,
  );

  const columns: Record<string, CellValue> = {};
  for (const [key, value] of Object.entries(scope.outputs)) {
    const cell = toCellValue(value);
    if (cell !== undefined) {
      columns[key] = cell;
    }
  }

  const costUsdRaw = scope.outputs['costUsd'];
  const costUsd = typeof costUsdRaw === 'number' ? costUsdRaw : null;

  const errorInfo = nonAssertError
    ? {
        name: nonAssertError.name,
        message: nonAssertError.message,
        stack: nonAssertError.stack,
      }
    : null;

  const caseDetail: CaseDetail = {
    caseId: evalCase.id,
    evalId,
    status,
    input: evalCase.input,
    trace: displayTrace,
    traceDisplay,
    cost: { totalUsd: costUsd },
    columns,
    assertionFailures: scope.assertionFailures,
    error: errorInfo,
    trial,
  };

  const caseRowUpdate: Partial<CaseRow> = {
    status,
    score: avgScore,
    latencyMs: elapsedMs,
    costUsd,
    columns,
  };

  return { caseDetail, caseRowUpdate };
}
