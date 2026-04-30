import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, join, relative } from 'node:path';
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
  CacheEntryWithDebugKey,
  CacheListItem,
  CacheMode,
  ResolvedApiCallsConfig,
  ResolvedLlmCallsConfig,
} from '@agent-evals/shared';
import {
  deriveScopedSummaryFromCases,
  resolveApiCallsConfig,
  resolveLlmCallsConfig,
} from '@agent-evals/shared';
import { watch, type FSWatcher } from 'chokidar';
import { glob } from 'glob';
import {
  createFsCacheStore,
  type CacheClearFilter,
  type FsCacheStore,
} from './cacheStore.ts';
import { validateCharts } from './chartValidation.ts';
import { buildDeclaredColumnDefs, normalizeScoreDef } from './columnBuilder.ts';
import { loadConfig } from './config.ts';
import { resolveEvalDefaultConfig } from './defaultConfig.ts';
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
  killRunChild,
  startRunChild,
  type RunnerRunState,
} from './runChildManager.ts';
import { type RunChildContext } from './runChildProtocol.ts';
import {
  persistRunState,
  recomputePersistedCaseStatus,
  recomputeEvalStatusesInRuns,
  runTouchesEval,
} from './runMaintenance.ts';
import { type EvalMeta, type RunState } from './runOrchestration.ts';
import {
  generateRunId,
  getLastRunStatuses,
  getLatestRunInfos,
  loadPersistedRunSnapshots,
  nextShortIdFromSnapshots,
  persistCaseDetail,
  type EvalLatestRunInfo,
  type PersistedRunSnapshot,
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
  /** Request cancellation for an in-flight run and persist its cancelled state. */
  cancelRun(id: string): Promise<void>;
  /** Return full details for a single case in a run, when available. */
  getCaseDetail(runId: string, caseId: string): CaseDetail | undefined;
  /** Subscribe to streamed events for a specific run. */
  subscribe(runId: string, listener: (event: SseEnvelope) => void): () => void;
  /** Subscribe to discovery updates triggered by file changes or manual refresh. */
  subscribeDiscovery(listener: (event: SseEnvelope) => void): () => void;
  /** Stop background filesystem watchers owned by this runner instance. */
  close(): Promise<void>;
  /** Resolve the workspace root backing this runner instance. */
  getWorkspaceRoot(): string;
  /**
   * Return whether the current workspace allows an unfiltered CLI run.
   *
   * `false` means `agent-evals run` must include `--eval` or `--case`.
   * Programmatic/server runs are intentionally unaffected.
   */
  getAllowCliRunAll(): boolean;
  /**
   * Resolved LLM-calls config used by the UI to derive the LLM calls tab.
   *
   * Returns the workspace's `llmCalls` config block from
   * `agent-evals.config.ts` with all defaults applied.
   */
  getLlmCallsConfig(): ResolvedLlmCallsConfig;
  /**
   * Resolved API-calls config used by the UI to derive the API calls tab.
   *
   * Returns the workspace's `apiCalls` config block from
   * `agent-evals.config.ts` with all defaults applied.
   */
  getApiCallsConfig(): ResolvedApiCallsConfig;
  /** Resolve a persisted artifact path when artifact storage is supported. */
  getArtifactPath(artifactId: string): string | undefined;
  /** Return summaries for every persisted cache entry in the workspace. */
  listCache(): Promise<CacheListItem[]>;
  /**
   * Return the full persisted cache entry for `namespace` + `key`, including
   * its recording and optional raw-key debug metadata. Returns `null` when no
   * entry matches. Used by the case drawer's Cache tab to lazily fetch the
   * cached return value when a row is expanded.
   */
  getCacheEntry(
    namespace: string,
    key: string,
  ): Promise<CacheEntryWithDebugKey | null>;
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

const globMagicCharacters = new Set([
  '*',
  '?',
  '[',
  ']',
  '{',
  '}',
  '(',
  ')',
  '!',
  '+',
  '@',
]);

function hasGlobMagic(value: string): boolean {
  for (const char of value) {
    if (globMagicCharacters.has(char)) return true;
  }
  return false;
}

function getWatchRootForIncludePattern(params: {
  pattern: string;
  workspaceRoot: string;
}): string {
  const normalizedPattern = params.pattern.replaceAll('\\', '/');
  const segments = normalizedPattern.split('/').filter((part) => part !== '');
  const firstGlobSegmentIndex = segments.findIndex(hasGlobMagic);

  if (firstGlobSegmentIndex === -1) {
    return dirname(resolve(params.workspaceRoot, params.pattern));
  }

  if (firstGlobSegmentIndex === 0) return params.workspaceRoot;

  return resolve(
    params.workspaceRoot,
    segments.slice(0, firstGlobSegmentIndex).join('/'),
  );
}

function getWatchRootsForIncludePatterns(params: {
  patterns: string[];
  workspaceRoot: string;
}): string[] {
  const roots = new Set<string>();

  for (const pattern of params.patterns) {
    roots.add(
      getWatchRootForIncludePattern({
        pattern,
        workspaceRoot: params.workspaceRoot,
      }),
    );
  }

  if (roots.size === 0) return [params.workspaceRoot];
  return [...roots];
}

/** Create an in-memory eval runner bound to the current workspace config. */
export function createRunner({
  watchForChanges = true,
}: CreateRunnerOptions = {}): EvalRunner {
  let config: AgentEvalsConfig;
  let workspaceRoot: string;
  let localStateDir: string;
  let cacheStore: FsCacheStore;
  let llmCallsConfig: ResolvedLlmCallsConfig = resolveLlmCallsConfig(undefined);
  let apiCallsConfig: ResolvedApiCallsConfig = resolveApiCallsConfig(undefined);
  const evals = new Map<string, EvalMeta>();
  const runs = new Map<string, RunnerRunState>();
  const lastRunStatusMap = new Map<string, EvalSummary['lastRunStatus']>();
  const latestRunInfoMap = new Map<string, EvalLatestRunInfo>();
  const discoveryListeners = new Set<(event: SseEnvelope) => void>();
  let nextShortIdNum = 0;
  let discoveryWatcher: FSWatcher | undefined;
  let runHistoryWatcher: FSWatcher | undefined;
  let discoveryRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let runHistoryRefreshTimer: ReturnType<typeof setTimeout> | undefined;

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

  const runner: EvalRunner = {
    async init() {
      config = await loadConfig();
      workspaceRoot = config.workspaceRoot ?? process.cwd();
      localStateDir = resolve(workspaceRoot, '.agent-evals');
      llmCallsConfig = resolveLlmCallsConfig(config.llmCalls);
      apiCallsConfig = resolveApiCallsConfig(config.apiCalls);

      await mkdir(localStateDir, { recursive: true });
      await mkdir(join(localStateDir, 'runs'), { recursive: true });

      cacheStore = createFsCacheStore({
        workspaceRoot,
        dir: config.cache?.dir,
        maxEntriesPerNamespace:
          config.cache?.maxEntriesPerNamespace ??
          config.cache?.maxEntriesPerEval,
        maxEntriesByNamespace: config.cache?.maxEntriesByNamespace,
      });

      await loadPersistedRuns();
      await runner.refreshDiscovery();
      if (watchForChanges) {
        await setupWatcher();
      }
    },
    async listCache() {
      return cacheStore.list();
    },
    async getCacheEntry(namespace, key) {
      return cacheStore.lookupWithDebug(namespace, key);
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
              const defaultConfig = resolveEvalDefaultConfig({
                evalDef,
                globalRemove: config.removeDefaultConfig,
              });
              columnDefs = buildDeclaredColumnDefs(
                defaultConfig.columns,
                evalDef.scores,
                evalDef.manualScores,
              );
              stats = defaultConfig.stats;
              const validated = validateCharts({
                charts: defaultConfig.charts,
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
        errorMessage: null,
      };

      const runState: RunnerRunState = {
        runDir,
        manifest,
        summary,
        cases: [],
        caseDetails: new Map(),
        listeners: new Set(),
        childProcess: undefined,
        childTerminalReceived: false,
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

      const childContext: RunChildContext = {
        request,
        workspaceRoot,
        runDir,
        manifest,
        summary,
      };
      await writeFile(
        join(runDir, 'run-child-context.json'),
        JSON.stringify(childContext, null, 2),
      );
      startRunChild({
        runState,
        contextPath: join(runDir, 'run-child-context.json'),
        managerContext: { workspaceRoot, evals, emitEvent, emitDiscoveryEvent },
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
    async cancelRun(id) {
      const run = runs.get(id);
      if (!run) return;
      if (run.manifest.status !== 'running') return;

      const endedAt = new Date();
      run.manifest.status = 'cancelled';
      run.manifest.endedAt = endedAt.toISOString();
      run.summary.status = 'cancelled';
      const derivedSummary = deriveScopedSummaryFromCases({
        caseRows: run.cases,
        lifecycleStatus: 'cancelled',
      });
      run.summary.totalCases = derivedSummary.totalCases;
      run.summary.passedCases = derivedSummary.passedCases;
      run.summary.failedCases = derivedSummary.failedCases;
      run.summary.errorCases = derivedSummary.errorCases;
      run.summary.cancelledCases = derivedSummary.cancelledCases;
      run.summary.totalDurationMs =
        endedAt.getTime() - new Date(run.manifest.startedAt).getTime();
      killRunChild(run);
      await persistRunState(run);
      emitEvent(run, {
        type: 'run.cancelled',
        runId: id,
        timestamp: new Date().toISOString(),
        payload: run.summary,
      });
      emitDiscoveryEvent();
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

    async close() {
      if (discoveryRefreshTimer !== undefined) {
        clearTimeout(discoveryRefreshTimer);
        discoveryRefreshTimer = undefined;
      }
      if (runHistoryRefreshTimer !== undefined) {
        clearTimeout(runHistoryRefreshTimer);
        runHistoryRefreshTimer = undefined;
      }

      const watchers = [discoveryWatcher, runHistoryWatcher].filter(
        (watcher): watcher is FSWatcher => watcher !== undefined,
      );
      discoveryWatcher = undefined;
      runHistoryWatcher = undefined;
      await Promise.all(watchers.map((watcher) => watcher.close()));
    },

    getWorkspaceRoot() {
      return workspaceRoot;
    },

    getAllowCliRunAll() {
      return config.allowCliRunAll === true;
    },

    getLlmCallsConfig() {
      return llmCallsConfig;
    },

    getApiCallsConfig() {
      return apiCallsConfig;
    },

    getArtifactPath(artifactId_) {
      return resolveArtifactPath(join(localStateDir, 'runs'), artifactId_);
    },
  };

  async function setupWatcher() {
    const watchRoots = getWatchRootsForIncludePatterns({
      patterns: config.include,
      workspaceRoot,
    });
    const watcher = watch(watchRoots, {
      ignoreInitial: true,
      persistent: true,
    });
    discoveryWatcher = watcher;

    const scheduleRefresh = () => {
      if (discoveryRefreshTimer !== undefined) {
        clearTimeout(discoveryRefreshTimer);
      }

      discoveryRefreshTimer = setTimeout(() => {
        discoveryRefreshTimer = undefined;
        void runner.refreshDiscovery();
      }, 50);
    };

    watcher.on('change', scheduleRefresh);
    watcher.on('add', scheduleRefresh);
    watcher.on('unlink', scheduleRefresh);
    watcher.on('addDir', scheduleRefresh);
    watcher.on('unlinkDir', scheduleRefresh);

    await setupRunHistoryWatcher();

    await new Promise<void>((ready) => {
      watcher.once('ready', ready);
    });
  }

  async function setupRunHistoryWatcher() {
    const watcher = watch(join(localStateDir, 'runs'), {
      ignoreInitial: true,
      persistent: true,
    });
    runHistoryWatcher = watcher;

    const scheduleRefresh = () => {
      if (runHistoryRefreshTimer !== undefined) {
        clearTimeout(runHistoryRefreshTimer);
      }

      runHistoryRefreshTimer = setTimeout(() => {
        runHistoryRefreshTimer = undefined;
        void refreshPersistedRunsFromDisk();
      }, 50);
    };

    watcher.on('change', scheduleRefresh);
    watcher.on('add', scheduleRefresh);
    watcher.on('unlink', scheduleRefresh);
    watcher.on('addDir', scheduleRefresh);
    watcher.on('unlinkDir', scheduleRefresh);

    await new Promise<void>((ready) => {
      watcher.once('ready', ready);
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
      runs.set(persistedRun.manifest.id, toRunnerRunState(persistedRun));
    }
  }

  async function refreshPersistedRunsFromDisk(): Promise<void> {
    const persistedRuns = await loadPersistedRunSnapshots(localStateDir);
    const persistedRunIds = new Set(
      persistedRuns.map((snapshot) => snapshot.manifest.id),
    );
    let changed = false;

    for (const persistedRun of persistedRuns) {
      const existing = runs.get(persistedRun.manifest.id);
      if (existing?.manifest.status === 'running' && existing.childProcess) {
        continue;
      }
      runs.set(
        persistedRun.manifest.id,
        toRunnerRunState(persistedRun, existing),
      );
      changed = true;
    }

    for (const [runId, existing] of [...runs]) {
      if (persistedRunIds.has(runId)) continue;
      if (existing.manifest.status === 'running') continue;
      runs.delete(runId);
      changed = true;
    }

    nextShortIdNum = Math.max(
      nextShortIdNum,
      nextShortIdFromSnapshots(persistedRuns),
    );
    if (changed) emitDiscoveryEvent();
  }

  function toRunnerRunState(
    snapshot: PersistedRunSnapshot,
    existing?: RunnerRunState,
  ): RunnerRunState {
    return {
      ...snapshot,
      listeners: existing?.listeners ?? new Set(),
      childProcess: existing?.childProcess,
      childTerminalReceived: existing?.childTerminalReceived ?? false,
    };
  }

  return runner;
}
