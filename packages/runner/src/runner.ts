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
} from '@agent-evals/shared';
import { deriveScopedSummaryFromCases } from '@agent-evals/shared';
import { watch } from 'chokidar';
import { glob } from 'glob';
import {
  createFsCacheStore,
  type CacheClearFilter,
  type FsCacheStore,
} from './cacheStore.ts';
import { validateCharts } from './chartValidation.ts';
import { buildDeclaredColumnDefs, normalizeScoreDef } from './columnBuilder.ts';
import { loadConfig } from './config.ts';
import { parseEvalMetas } from './discovery.ts';
import { loadEvalModule } from './evalModuleLoader.ts';
import {
  buildEvalSummary,
  getTargetEvalIds,
  setLatestRunInfoMap,
} from './evalSummaries.ts';
import { readGitWorktreeState } from './gitState.ts';
import { resolveArtifactPath } from './outputArtifacts.ts';
import {
  persistRunState,
  recomputePersistedCaseStatus,
  recomputeEvalStatusesInRuns,
  runTouchesEval,
} from './runMaintenance.ts';
import {
  executeRun,
  type EvalMeta,
  type RunState,
} from './runOrchestration.ts';
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
  /** Persist a UI-authored manual score for one case and recompute affected summaries. */
  updateManualScore(params: {
    runId: string;
    caseId: string;
    scoreKey: string;
    value: number | null;
  }): Promise<
    | {
        updated: true;
        run: { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] };
        caseDetail: CaseDetail;
      }
    | { updated: false; reason: string }
  >;
  /**
   * Delete one persisted run from in-memory history and disk.
   *
   * Ignored for in-flight runs — cancel first, then delete.
   * Returns `deleted: false` when the run is missing or still running.
   */
  deleteRun(runId: string): Promise<{ deleted: boolean }>;
};

type CreateRunnerOptions = { watchForChanges?: boolean };

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
      await loadEvalModule(
        evalMeta.sourceFilePath,
        evalMeta.sourceFingerprint ?? undefined,
      );
      const entry = registry.get(evalId);
      if (!entry) return { updatedRuns: 0 };

      const scoreThresholds = new Map<string, number>();
      entry.use((evalDef) => {
        for (const [key, def] of Object.entries(evalDef.scores ?? {})) {
          const threshold = normalizeScoreDef(def).passThreshold;
          if (threshold !== undefined) scoreThresholds.set(key, threshold);
        }
        for (const [key, def] of Object.entries(evalDef.manualScores ?? {})) {
          if (def.passThreshold !== undefined) {
            scoreThresholds.set(key, def.passThreshold);
          }
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
    async updateManualScore({ runId, caseId, scoreKey, value }) {
      const run = runs.get(runId);
      if (!run) return { updated: false, reason: 'Run not found' };
      if (run.manifest.status === 'running') {
        return { updated: false, reason: 'Run is still running' };
      }

      const caseRow = run.cases.find((row) => row.caseId === caseId);
      if (!caseRow) return { updated: false, reason: 'Case not found' };

      const evalMeta = evals.get(caseRow.evalId);
      if (!evalMeta) {
        return { updated: false, reason: 'Eval not found' };
      }
      const columnDef = evalMeta.columnDefs.find((def) => def.key === scoreKey);
      if (columnDef?.isManualScore !== true) {
        return { updated: false, reason: 'Manual score not found' };
      }

      const caseDetail = run.caseDetails.get(caseId);
      if (!caseDetail) {
        return { updated: false, reason: 'Case detail not found' };
      }

      caseRow.columns[scoreKey] = value;
      caseDetail.columns[scoreKey] = value;

      const scoreThresholds = new Map<string, number>();
      for (const def of evalMeta.columnDefs) {
        if (def.isScore !== true || def.passThreshold === undefined) continue;
        scoreThresholds.set(def.key, def.passThreshold);
      }

      const nextStatus = recomputePersistedCaseStatus(
        caseRow,
        caseDetail,
        scoreThresholds,
      );
      caseRow.status = nextStatus;
      caseDetail.status = nextStatus;

      const derivedSummary = deriveScopedSummaryFromCases({
        caseRows: run.cases,
      });
      run.summary.totalCases = derivedSummary.totalCases;
      run.summary.passedCases = derivedSummary.passedCases;
      run.summary.failedCases = derivedSummary.failedCases;
      run.summary.errorCases = derivedSummary.errorCases;
      run.summary.cancelledCases = derivedSummary.cancelledCases;
      run.summary.totalDurationMs = derivedSummary.totalDurationMs;
      run.summary.cost = derivedSummary.cost;

      await persistCaseDetail(run.runDir, caseDetail);
      await persistRunState(run);
      emitDiscoveryEvent();

      return {
        updated: true,
        run: { manifest: run.manifest, summary: run.summary, cases: run.cases },
        caseDetail,
      };
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
          const sourceFingerprint = getSourceFingerprint(content);
          const registry = getEvalRegistry();
          try {
            await loadEvalModule(filePath, sourceFingerprint);
          } catch {
            // Fall back to statically parsed metadata when the module fails to load.
          }
          for (const meta of discoveredMetas) {
            const discoveredEntry = registry.get(meta.id);
            const title = meta.title;
            let columnDefs = buildDeclaredColumnDefs(
              undefined,
              undefined,
              undefined,
            );
            let stats: EvalMeta['stats'];
            let charts: EvalMeta['charts'];

            discoveredEntry?.use((evalDef) => {
              columnDefs = buildDeclaredColumnDefs(
                evalDef.columns,
                evalDef.scores,
                evalDef.manualScores,
              );
              stats = evalDef.stats;
              const validated = validateCharts({
                charts: evalDef.charts,
                columnDefs,
                evalId: meta.id,
              });
              for (const warning of validated.warnings) {
                console.warn(warning);
              }
              charts = validated.charts;
            });

            evals.set(meta.id, {
              id: meta.id,
              title,
              filePath: toWorkspaceRelativePath(meta.filePath),
              sourceFilePath: meta.filePath,
              sourceFingerprint,
              columnDefs,
              caseCount: null,
              stats,
              charts,
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

      void executeRun({
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
      });

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
      return resolveArtifactPath(join(localStateDir, 'runs'), artifactId_);
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
      knownEvals: evals.values(),
    });
    const latestRunInfos = getLatestRunInfos({
      runs: runs.values(),
      knownEvals: evals.values(),
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
