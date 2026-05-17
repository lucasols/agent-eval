import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import type { EvalManualInputConfig } from '@agent-evals/sdk';
import type {
  EvalSummary,
  RunManifest,
  RunSummary,
  SseEnvelope,
  AgentEvalsConfig,
  CacheMode,
  ResolvedApiCallsConfig,
  ResolvedLlmCallsConfig,
  DiscoveryIssue,
} from '@agent-evals/shared';
import {
  buildEvalKey,
  deriveScopedSummaryFromCases,
  getCaseRowCaseKey,
  resolveApiCallsConfig,
  resolveLlmCallsConfig,
} from '@agent-evals/shared';
import { watch, type FSWatcher } from 'chokidar';
import { glob } from 'glob';
import { createFsCacheStore, type FsCacheStore } from './cacheStore.ts';
import { resolveCaseDetailLookup } from './caseDetailLookup.ts';
import { validateCharts } from './chartValidation.ts';
import { buildDeclaredColumnDefs, normalizeScoreDef } from './columnBuilder.ts';
import { loadConfig } from './config.ts';
import { createConfigReloadController } from './configReload.ts';
import { resolveEvalDefaultConfig } from './defaultConfig.ts';
import { parseEvalDiscovery } from './discovery.ts';
import { loadIsolatedEvalRegistry } from './evalRegistryLoader.ts';
import { buildEvalSummary, setLatestRunInfoMap } from './evalSummaries.ts';
import { readGitWorktreeState } from './gitState.ts';
import { resolveManualInputDiscovery } from './manualInput/discovery.ts';
import {
  cleanupStagedManualInputFiles,
  materializeManualInputFiles,
} from './manualInput/files.ts';
import { validateManualInputsForRequest } from './manualInput/validation.ts';
import { isRecord } from './objectUtils.ts';
import { resolveArtifactPath } from './outputArtifacts.ts';
import { recalculateDerivedAttributesForCase as recalculateDerivedAttributesForRunCase } from './recalculateDerivedAttributes.ts';
import {
  killRunChild,
  startRunChild,
  type RunnerRunState,
} from './runChildManager.ts';
import { type RunChildContext } from './runChildProtocol.ts';
import {
  persistRunState,
  deleteTemporaryRuns,
  recomputePersistedCaseStatus,
  recomputeEvalStatusesInRuns,
  runTouchesEval,
} from './runMaintenance.ts';
import { toRunnerRunState } from './runnerStateHydration.ts';
import type { EvalRunner } from './runnerTypes.ts';
import { type EvalMeta, type RunState } from './runOrchestration.ts';
import {
  generateRunId,
  getLastRunStatuses,
  getLatestRunInfos,
  loadPersistedRunSnapshots,
  nextShortIdFromSnapshots,
  persistCaseDetail,
  type EvalLatestRunInfo,
} from './runPersistence.ts';
import { buildPersistedRunTarget } from './runTargetPersistence.ts';
import { resolveEvalTags, validateTagsFilters } from './tags.ts';
import { getTargetEvalKeys } from './targeting.ts';
import { getWatchRootsForIncludePatterns } from './watchRoots.ts';

export type {
  ManualInputValidationFailure,
  ManualInputValidationResult,
} from './manualInput/validation.ts';
export type { EvalRunner } from './runnerTypes.ts';

/** Create an in-memory eval runner bound to the current workspace config. */
export function createRunner({
  watchForChanges = true,
}: { watchForChanges?: boolean } = {}): EvalRunner {
  let config: AgentEvalsConfig;
  let workspaceRoot: string;
  let localStateDir: string;
  let cacheStore: FsCacheStore;
  let llmCallsConfig: ResolvedLlmCallsConfig = resolveLlmCallsConfig(undefined);
  let apiCallsConfig: ResolvedApiCallsConfig = resolveApiCallsConfig(undefined);
  const evals = new Map<string, EvalMeta>();
  const manualInputConfigs = new Map<string, EvalManualInputConfig<unknown>>();
  let discoveryIssues: DiscoveryIssue[] = [];
  const runs = new Map<string, RunnerRunState>();
  const lastRunStatusMap = new Map<string, EvalSummary['lastRunStatus']>();
  const latestRunInfoMap = new Map<string, EvalLatestRunInfo>();
  const discoveryListeners = new Set<(event: SseEnvelope) => void>();
  let nextShortIdNum = 0;
  let discoveryWatcher: FSWatcher | undefined;
  let runHistoryWatcher: FSWatcher | undefined;
  let discoveryRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let runHistoryRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let registryLoadCounter = 0;
  const configReload = createConfigReloadController({
    getActiveRunCount,
    closeRunnerWatchers: closeWatchers,
    loadRunnerState,
    emitToDiscoveryListeners,
  });

  function toWorkspaceRelativePath(filePath: string): string {
    return relative(workspaceRoot, filePath).replaceAll('\\', '/');
  }

  function getSortedEvalMetas(): EvalMeta[] {
    return [...evals.values()].toSorted(
      (a, b) =>
        a.filePath.localeCompare(b.filePath) || a.id.localeCompare(b.id),
    );
  }

  function resolveEvalMeta(evalRef: string): EvalMeta | undefined {
    const exactMatch = evals.get(evalRef);
    if (exactMatch !== undefined) return exactMatch;

    const matches = getSortedEvalMetas().filter((ev) => ev.id === evalRef);
    return matches.length === 1 ? matches[0] : undefined;
  }

  function getSourceFingerprint(source: string): string {
    return createHash('sha256').update(source).digest('hex');
  }

  function nextRegistryLoadIsolationKey(
    prefix: string,
    filePath: string,
  ): string {
    registryLoadCounter++;
    return `${prefix}:${String(registryLoadCounter)}:${filePath}`;
  }

  const runner: EvalRunner = {
    async init() {
      await loadRunnerState();
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
    async recomputeStatusesForEval(evalKey) {
      const evalMeta = resolveEvalMeta(evalKey);
      if (!evalMeta) return { updatedRuns: 0 };

      const registry = await loadIsolatedEvalRegistry({
        evalFilePath: evalMeta.sourceFilePath,
        sourceFingerprint: evalMeta.sourceFingerprint ?? undefined,
        moduleIsolation: {
          key: nextRegistryLoadIsolationKey(
            'recompute-status',
            evalMeta.sourceFilePath,
          ),
          workspaceRoot,
        },
        runtimeScope: 'env',
      });
      const entry = registry.get(evalMeta.id);
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
        evalKey: evalMeta.key,
        evalExists: evals.has(evalMeta.key),
        scoreThresholds,
        persistCaseDetail,
      });

      emitDiscoveryEvent();
      return { updatedRuns };
    },
    async recalculateDerivedAttributesForCase({ runId, caseId }) {
      const run = runs.get(runId);
      if (!run) return { updated: false, reason: 'Run not found' };
      return recalculateDerivedAttributesForRunCase({
        run,
        caseId,
        llmCallsConfig,
        apiCallsConfig,
        traceDisplayConfig: config.traceDisplay,
        evals,
        persistCaseDetail,
      });
    },
    async cleanRunsForEval(evalKey) {
      const evalMeta = resolveEvalMeta(evalKey);
      let deletedRuns = 0;
      for (const [runId, run] of [...runs]) {
        if (
          !runTouchesEval({
            target: run.manifest.target,
            caseRows: run.cases,
            evalKey: evalMeta?.key ?? evalKey,
            evalExists: evalMeta !== undefined,
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

      const caseRow = run.cases.find(
        (row) => getCaseRowCaseKey(row) === caseId || row.caseId === caseId,
      );
      if (!caseRow) return { updated: false, reason: 'Case not found' };

      const evalMeta =
        caseRow.evalKey === undefined ? undefined : evals.get(caseRow.evalKey);
      if (!evalMeta) {
        return { updated: false, reason: 'Eval not found' };
      }
      const columnDef = evalMeta.columnDefs.find((def) => def.key === scoreKey);
      if (columnDef?.isManualScore !== true) {
        return { updated: false, reason: 'Manual score not found' };
      }

      const caseDetail = run.caseDetails.get(getCaseRowCaseKey(caseRow));
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
    async promoteRun(runId) {
      const run = runs.get(runId);
      if (!run) return { promoted: false };

      const wasTemporary = run.manifest.temporary === true;
      if (wasTemporary) {
        run.manifest.temporary = false;
        await persistRunState(run);
        emitDiscoveryEvent();
      }

      return {
        promoted: wasTemporary,
        run: { manifest: run.manifest, summary: run.summary, cases: run.cases },
      };
    },
    validateManualInputs(request) {
      return validateManualInputsForRequest({
        evalMetas: getSortedEvalMetas(),
        manualInputConfigs,
        request,
      });
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
            latestRun: latestRunInfoMap.get(meta.key),
            lastRunStatus: lastRunStatusMap.get(meta.key) ?? null,
          }),
        );
      }
      return result;
    },
    getEval(id) {
      const meta = resolveEvalMeta(id);
      if (!meta) return undefined;
      return buildEvalSummary({
        meta,
        config,
        gitState: readGitWorktreeState(workspaceRoot),
        latestRun: latestRunInfoMap.get(meta.key),
        lastRunStatus: lastRunStatusMap.get(meta.key) ?? null,
      });
    },
    getDiscoveryIssues() {
      return discoveryIssues;
    },
    getConfigReloadState() {
      return configReload.currentState();
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
      manualInputConfigs.clear();
      discoveryIssues = [];
      for (const filePath of discovered) {
        try {
          const content = await readFile(filePath, 'utf-8');
          const discovery = parseEvalDiscovery(filePath, content);
          const discoveredMetas = discovery.metas;
          discoveryIssues.push(
            ...discovery.issues.map((issue) => ({
              ...issue,
              filePath: toWorkspaceRelativePath(issue.filePath),
              message: `Duplicate eval id "${issue.evalId}" in ${toWorkspaceRelativePath(issue.filePath)}. Eval ids must be unique within one file.`,
            })),
          );
          const sourceFingerprint = getSourceFingerprint(content);
          let loadedRegistry:
            | Awaited<ReturnType<typeof loadIsolatedEvalRegistry>>
            | undefined;
          try {
            loadedRegistry = await loadIsolatedEvalRegistry({
              evalFilePath: filePath,
              sourceFingerprint,
              moduleIsolation: {
                key: nextRegistryLoadIsolationKey('discovery', filePath),
                workspaceRoot,
              },
              runtimeScope: 'env',
            });
          } catch {
            // Fall back to statically parsed metadata when the module fails to load.
          }
          for (const meta of discoveredMetas) {
            const discoveredEntry = loadedRegistry?.get(meta.id);
            const title = meta.title;
            let columnDefs = buildDeclaredColumnDefs(
              undefined,
              undefined,
              undefined,
            );
            let stats: EvalMeta['stats'];
            let defaultStatAggregate: EvalMeta['defaultStatAggregate'];
            let charts: EvalMeta['charts'];
            let tags: string[] = [];
            let manualInputDescriptor: EvalMeta['manualInputDescriptor'];
            let requiresManualInput = false;
            const relativeFilePath = toWorkspaceRelativePath(meta.filePath);

            discoveredEntry?.use((evalDef) => {
              const tagResult = resolveEvalTags({
                configTags: config.tags,
                evalDef,
                evalId: meta.id,
                filePath: relativeFilePath,
              });
              tags = tagResult.tags;
              discoveryIssues.push(...tagResult.issues);

              const defaultConfig = resolveEvalDefaultConfig({
                evalDef,
                globalColumns: config.columns,
                globalStats: config.stats,
                globalDefaultStatAggregate: config.defaultStatAggregate,
                globalRemove: config.removeDefaultConfig,
              });
              columnDefs = buildDeclaredColumnDefs(
                defaultConfig.columns,
                evalDef.scores,
                evalDef.manualScores,
              );
              stats = defaultConfig.stats;
              defaultStatAggregate = defaultConfig.defaultStatAggregate;
              const validated = validateCharts({
                charts: defaultConfig.charts,
                columnDefs,
                evalId: meta.id,
              });
              for (const warning of validated.warnings) {
                console.warn(warning);
              }
              charts = validated.charts;

              const manualInputResult = resolveManualInputDiscovery({
                evalDef,
                evalId: meta.id,
                relativeFilePath,
              });
              if (manualInputResult.kind === 'issue') {
                discoveryIssues.push(manualInputResult.issue);
                requiresManualInput = true;
                return;
              }
              if (manualInputResult.kind === 'ok') {
                requiresManualInput = manualInputResult.requiresManualInput;
                manualInputDescriptor = manualInputResult.descriptor;
                manualInputConfigs.set(
                  buildEvalKey({ filePath: relativeFilePath, evalId: meta.id }),
                  manualInputResult.config,
                );
              }
            });

            const key = buildEvalKey({
              filePath: relativeFilePath,
              evalId: meta.id,
            });
            evals.set(key, {
              key,
              id: meta.id,
              title,
              filePath: relativeFilePath,
              tags,
              sourceFilePath: meta.filePath,
              sourceFingerprint,
              columnDefs,
              caseCount: null,
              caseIds: undefined,
              stats,
              defaultStatAggregate,
              charts,
              manualInputDescriptor,
              requiresManualInput,
            });
          }
        } catch {
          // skip files that can't be parsed
        }
      }

      emitDiscoveryEvent();
    },
    async startRun(request) {
      const tagsFilterError = validateTagsFilters(request.target.tagsFilter);
      if (tagsFilterError !== null) throw new Error(tagsFilterError);

      const deletedTemporaryRuns = await deleteTemporaryRuns({
        runs,
        cancelRunningRun: killRunChild,
      });
      const runId = generateRunId();
      const shortId = `r${String(nextShortIdNum++)}`;
      const now = new Date().toISOString();
      const cacheMode: CacheMode = request.cache?.mode ?? 'use';
      const runDir = join(localStateDir, 'runs', runId);
      const gitState = readGitWorktreeState(workspaceRoot);
      const targetEvalKeys = getTargetEvalKeys({
        request,
        sortedEvals: getSortedEvalMetas(),
      });

      const manifest: RunManifest = {
        id: runId,
        shortId,
        status: 'running',
        temporary: request.temporary === true,
        startedAt: now,
        endedAt: null,
        commitSha: gitState.commitSha,
        evalSourceFingerprints: {},
        target: buildPersistedRunTarget({
          target: request.target,
          evalKeys: targetEvalKeys,
        }),
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

      await mkdir(runDir, { recursive: true });
      await mkdir(join(runDir, 'traces'), { recursive: true });
      await mkdir(join(runDir, 'artifacts'), { recursive: true });
      await mkdir(join(runDir, 'case-details'), { recursive: true });

      const materializedRequest = { ...request };
      if (request.manualInputs !== undefined) {
        const materialized = await materializeManualInputFiles({
          workspaceRoot,
          runId,
          runDir,
          value: request.manualInputs,
        });
        if (materialized.error !== null) {
          throw new Error(materialized.error);
        }
        if (!isRecord(materialized.value)) {
          throw new Error('Materialized manual inputs must be an object');
        }
        materializedRequest.manualInputs = materialized.value;
      }

      runs.set(runId, runState);
      setLatestRunInfoMap({
        latestRunInfoMap,
        evalIds: targetEvalKeys,
        info: {
          status: 'running',
          startedAt: now,
          commitSha: manifest.commitSha ?? null,
          evalSourceFingerprint: null,
        },
      });

      await writeFile(
        join(runDir, 'run.json'),
        JSON.stringify(manifest, null, 2),
      );

      const childContext: RunChildContext = {
        request: materializedRequest,
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

      if (deletedTemporaryRuns > 0) emitDiscoveryEvent();
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
      return resolveCaseDetailLookup(run, caseId);
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
      await Promise.all([closeWatchers(), configReload.close()]);
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

  async function loadRunnerState(): Promise<void> {
    config = await loadConfig();
    workspaceRoot = config.workspaceRoot ?? process.cwd();
    localStateDir = resolve(workspaceRoot, '.agent-evals');
    llmCallsConfig = resolveLlmCallsConfig(config.llmCalls);
    apiCallsConfig = resolveApiCallsConfig(config.apiCalls);

    await mkdir(localStateDir, { recursive: true });
    await mkdir(join(localStateDir, 'runs'), { recursive: true });
    await cleanupStagedManualInputFiles(workspaceRoot);

    cacheStore = createFsCacheStore({
      workspaceRoot,
      dir: config.cache?.dir,
      maxEntriesPerNamespace:
        config.cache?.maxEntriesPerNamespace ?? config.cache?.maxEntriesPerEval,
      maxEntriesByNamespace: config.cache?.maxEntriesByNamespace,
    });

    await loadPersistedRuns();
    await runner.refreshDiscovery();
    if (watchForChanges) {
      await setupWatcher();
    }
  }

  async function closeWatchers(): Promise<void> {
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
  }

  async function setupWatcher() {
    const watchRoots = getWatchRootsForIncludePatterns({
      patterns: config.include,
      workspaceRoot,
    });
    const watcher = watch(watchRoots, {
      ignoreInitial: true,
      persistent: true,
    });
    const watcherReady = new Promise<void>((ready) => {
      watcher.once('ready', ready);
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

    await Promise.all([setupRunHistoryWatcher(), configReload.setupWatcher()]);

    await watcherReady;
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

  function getActiveRunCount(): number {
    return [...runs.values()].filter((run) => run.manifest.status === 'running')
      .length;
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
    void configReload.reloadIfPendingAndIdle();
  }

  function emitToDiscoveryListeners(event: SseEnvelope): void {
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

  return runner;
}
