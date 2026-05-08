import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getEvalRegistry,
  runInEvalRuntimeScope,
  runWithEvalClock,
} from '@agent-evals/sdk';
import type {
  AgentEvalsConfig,
  CacheMode,
  CaseDetail,
  CaseRow,
  ColumnDef,
  CreateRunRequest,
  DiscoveryIssue,
  EvalChartsConfig,
  EvalStatsConfig,
  EvalSummary,
  ManualInputDescriptor,
  RunManifest,
  RunSummary,
  SseEnvelope,
  TrialSelectionMode,
} from '@agent-evals/shared';
import {
  deriveStatusFromCaseRows,
  getCaseRowCaseKey,
  resolveApiCallsConfig,
  resolveLlmCallsConfig,
} from '@agent-evals/shared';
import {
  createBufferedCacheStore,
  type BufferedCacheStore,
  type FsCacheStore,
} from './cacheStore.ts';
import { validateCharts } from './chartValidation.ts';
import { buildDeclaredColumnDefs } from './columnBuilder.ts';
import { resolveEvalDefaultConfig } from './defaultConfig.ts';
import { loadEvalModule } from './evalModuleLoader.ts';
import { parseManualInputValues } from './manualInput/walker.ts';
import { runWithModuleIsolation } from './moduleIsolation.ts';
import {
  filterEvalCases,
  resolveRunnableEvalCases,
  runCase,
} from './runExecution.ts';
import { persistRunState } from './runMaintenance.ts';
import { persistCaseDetail, type EvalLatestRunInfo } from './runPersistence.ts';
import { executeQueuedCases, type QueuedCaseRun } from './runQueue.ts';
import {
  evalTagsMatchFilter,
  filterEvalCasesByTags,
  resolveCaseTags,
  resolveEvalTags,
  validateTagsFilters,
  type TaggedEvalCase,
} from './tags.ts';
import { getTargetEvalKeys } from './targeting.ts';

export type EvalMeta = {
  key: string;
  id: string;
  title?: string;
  filePath: string;
  tags: string[];
  sourceFilePath: string;
  sourceFingerprint: string | null;
  columnDefs: ColumnDef[];
  caseCount: number | null;
  caseIds?: string[];
  stats?: EvalStatsConfig;
  charts?: EvalChartsConfig;
  /**
   * Wire-format descriptor for the eval's manual-input modal. Present only
   * when the eval declares `manualInput` and the schema-walker accepts the
   * authored Zod schema.
   */
  manualInputDescriptor?: ManualInputDescriptor;
  /**
   * Whether the eval requires a manual-input submission before any run can
   * start. Distinct from `manualInputDescriptor` so the UI/CLI can flag this
   * even if descriptor construction failed (the eval still cannot run).
   */
  requiresManualInput?: boolean;
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
  evalCaseRows: CaseRow[];
  preparedCases: PreparedEvalCase[];
  scoreKeys: readonly string[];
};

type EvalRunError = { evalId: string; details: string };

type ExecuteRunParams = {
  runState: RunState;
  request: CreateRunRequest;
  runDir: string;
  config: AgentEvalsConfig;
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

function formatUnknownErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function findDuplicateCaseIds(cases: readonly { id: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const evalCase of cases) {
    counts.set(evalCase.id, (counts.get(evalCase.id) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([caseId]) => caseId)
    .toSorted();
}

function throwIfDiscoveryIssues(issues: readonly DiscoveryIssue[]): void {
  if (issues.length === 0) return;
  throw new Error(issues.map((issue) => issue.message).join('\n'));
}

function findAmbiguousTargetCaseIds(
  preparedEvals: readonly PreparedEvalRun[],
): string[] {
  const ownersByCaseId = new Map<string, Set<string>>();
  for (const preparedEval of preparedEvals) {
    for (const preparedCase of preparedEval.preparedCases) {
      const owners = ownersByCaseId.get(preparedCase.caseId) ?? new Set();
      owners.add(
        `${preparedEval.evalMeta.filePath}#${preparedEval.evalMeta.id}`,
      );
      ownersByCaseId.set(preparedCase.caseId, owners);
    }
  }
  return [...ownersByCaseId]
    .filter(([, owners]) => owners.size > 1)
    .map(([caseId, owners]) => `${caseId} (${[...owners].join(', ')})`);
}

function buildRunErrorMessage(errors: EvalRunError[]): string {
  return errors
    .map((entry) => {
      const [firstLine, ...detailLines] = entry.details.split('\n');
      const messageLine = firstLine?.trim() ?? 'Unknown error';
      const details = detailLines.join('\n').trim();
      if (details.length === 0) return `[${entry.evalId}] ${messageLine}`;
      return `[${entry.evalId}] ${messageLine}\n${details}`;
    })
    .join('\n');
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

  const artifactFileId = getCaseArtifactFileId(runState, winningTrial.caseRow);
  runState.cases.push(winningTrial.caseRow);
  runState.caseDetails.set(
    getCaseRowCaseKey(winningTrial.caseRow),
    winningTrial.caseDetail,
  );

  if (winningTrial.caseRow.status === 'pass') {
    runState.summary.passedCases++;
  } else if (winningTrial.caseRow.status === 'error') {
    runState.summary.errorCases++;
  } else {
    runState.summary.failedCases++;
  }

  await writeFile(
    join(runDir, 'traces', `${encodeURIComponent(artifactFileId)}.json`),
    JSON.stringify(winningTrial.caseDetail.trace, null, 2),
  );
  await persistCaseDetail(runDir, winningTrial.caseDetail, artifactFileId);
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
  return `${caseRow.evalKey ?? caseRow.evalId}\u0000${caseRow.caseId}`;
}

function getCaseArtifactFileId(runState: RunState, caseRow: CaseRow): string {
  const caseKey = getCaseRowCaseKey(caseRow);
  const collides = runState.cases.some(
    (existing) =>
      existing.caseId === caseRow.caseId &&
      getCaseRowCaseKey(existing) !== caseKey,
  );
  return collides ? caseKey : caseRow.caseId;
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
        `${preparedEval.evalMeta.key}\u0000${preparedCase.caseId}`,
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
    const tagsFilterError = validateTagsFilters(request.target.tagsFilter);
    if (tagsFilterError !== null) {
      throw new Error(tagsFilterError);
    }
    const targetEvals = getTargetEvals(request);

    emitEvent(runState, {
      type: 'run.started',
      runId: runState.manifest.id,
      timestamp: new Date().toISOString(),
      payload: runState.manifest,
    });

    const evalErrors: EvalRunError[] = [];
    const queuedCases: QueuedCaseRun[] = [];
    const preparedEvals: PreparedEvalRun[] = [];
    const cacheMode: CacheMode = runState.manifest.cacheMode ?? 'use';
    const cacheEnabled = config.cache?.enabled !== false;
    const moduleIsolation = { key: runState.manifest.id, workspaceRoot };
    const llmCallsConfig = resolveLlmCallsConfig(config.llmCalls);
    const apiCallsConfig = resolveApiCallsConfig(config.apiCalls);

    for (const evalMeta of targetEvals) {
      const evalFilePath = evalMeta.sourceFilePath;
      let sourceFingerprint = '';
      try {
        const source = await readFile(evalFilePath, 'utf-8');
        sourceFingerprint = getSourceFingerprint(source);
      } catch {
        sourceFingerprint = '';
      }
      if (sourceFingerprint.length > 0) {
        runState.manifest.evalSourceFingerprints[evalMeta.key] =
          sourceFingerprint;
        evalMeta.sourceFingerprint = sourceFingerprint;
      } else {
        delete runState.manifest.evalSourceFingerprints[evalMeta.key];
        evalMeta.sourceFingerprint = null;
      }

      try {
        const registry = getEvalRegistry();
        await runWithModuleIsolation(moduleIsolation, async () => {
          await runInEvalRuntimeScope('env', async () => {
            await loadEvalModule(evalFilePath, sourceFingerprint);
          });
        });

        const entry = registry.get(evalMeta.id);
        if (!entry) {
          evalErrors.push({
            evalId: evalMeta.id,
            details: `Eval "${evalMeta.id}" was not registered after importing ${evalFilePath}`,
          });
          continue;
        }

        await runWithModuleIsolation(moduleIsolation, async () => {
          await runInEvalRuntimeScope('cases', async () => {
            await entry.use(async (evalDef) => {
              const evalTagsResult = resolveEvalTags({
                configTags: config.tags,
                evalDef,
                evalId: evalMeta.id,
                filePath: evalMeta.filePath,
              });
              throwIfDiscoveryIssues(evalTagsResult.issues);
              evalMeta.tags = evalTagsResult.tags;

              if (evalDef.manualInput && evalDef.cases !== undefined) {
                throw new Error(
                  `Eval "${evalMeta.id}" cannot declare both "cases" and "manualInput". Remove one of them.`,
                );
              }

              let manualInputCase: TaggedEvalCase | null = null;
              if (evalDef.manualInput) {
                const manualTags = evalTagsResult.tags;
                if (
                  !filterEvalCasesByTags(
                    [
                      {
                        id: `${evalMeta.id}-manual`,
                        input: {},
                        tags: manualTags,
                      },
                    ],
                    request.target.tagsFilter,
                  ).length
                ) {
                  evalMeta.caseCount = 1;
                  evalMeta.caseIds = [`${evalMeta.id}-manual`];
                  return;
                }
                const rawValue = request.manualInputs?.[evalMeta.key];
                if (rawValue === undefined) {
                  throw new Error(
                    `Eval "${evalMeta.id}" requires manual input. Provide it via the run modal in the web UI or "--input" / "--input-file" on the CLI.`,
                  );
                }
                const parsed = parseManualInputValues(
                  evalDef.manualInput,
                  rawValue,
                );
                if (parsed.error) {
                  const formatted = parsed.error.issues
                    .map((issue) =>
                      issue.path
                        ? `${issue.path}: ${issue.message}`
                        : issue.message,
                    )
                    .join('; ');
                  throw new Error(
                    `Invalid manual input for eval "${evalMeta.id}": ${formatted}`,
                  );
                }
                manualInputCase = {
                  id: `${evalMeta.id}-manual`,
                  input: parsed.value,
                  tags: manualTags,
                };
              }

              const evalCases = manualInputCase
                ? [manualInputCase]
                : typeof evalDef.cases === 'function' &&
                    !evalTagsMatchFilter({
                      tags: evalTagsResult.tags,
                      tagsFilter: request.target.tagsFilter,
                    })
                  ? []
                  : await runWithEvalClock(
                      evalDef.startTime,
                      async () =>
                        typeof evalDef.cases === 'function'
                          ? await evalDef.cases()
                          : (evalDef.cases ?? []),
                      { freezeTime: evalDef.freezeTime },
                    );
              const runnableCases = (
                manualInputCase
                  ? evalCases
                  : resolveRunnableEvalCases({
                      cases: evalCases,
                      evalId: evalMeta.id,
                    })
              ).map((evalCase) => ({
                ...evalCase,
                tags: resolveCaseTags({
                  evalTags: evalTagsResult.tags,
                  evalCase,
                  evalId: evalMeta.id,
                  filePath: evalMeta.filePath,
                }),
              }));
              const duplicateCaseIds = findDuplicateCaseIds(runnableCases);
              if (duplicateCaseIds.length > 0) {
                throw new Error(
                  `Duplicate case id${duplicateCaseIds.length === 1 ? '' : 's'} in ${evalMeta.filePath}#${evalMeta.id}: ${duplicateCaseIds.join(', ')}`,
                );
              }
              const cases = filterEvalCasesByTags(
                filterEvalCases(runnableCases, request.target.caseIds),
                request.target.tagsFilter,
              );
              evalMeta.caseCount = runnableCases.length;
              evalMeta.caseIds = runnableCases.map((evalCase) => evalCase.id);

              runState.summary.totalCases += cases.length;

              const defaultConfig = resolveEvalDefaultConfig({
                evalDef,
                globalColumns: config.columns,
                globalStats: config.stats,
                globalRemove: config.removeDefaultConfig,
              });
              const declaredColumnDefs = buildDeclaredColumnDefs(
                defaultConfig.columns,
                evalDef.scores,
                evalDef.manualScores,
              );
              const validatedCharts = validateCharts({
                charts: defaultConfig.charts,
                columnDefs: declaredColumnDefs,
                evalId: evalMeta.id,
              });
              for (const warning of validatedCharts.warnings) {
                console.warn(warning);
              }
              evalMeta.columnDefs = declaredColumnDefs;
              evalMeta.stats = defaultConfig.stats;
              evalMeta.charts = validatedCharts.charts;

              const evalCaseRows: CaseRow[] = [];
              const preparedCases: PreparedEvalCase[] = [];
              const scoreKeys = Object.freeze(
                Object.keys(evalDef.scores ?? {}),
              );
              const manualScoreKeys = Object.freeze(
                Object.keys(evalDef.manualScores ?? {}),
              );
              const preparedEval: PreparedEvalRun = {
                evalMeta,
                evalCaseRows,
                preparedCases,
                scoreKeys: Object.freeze([...scoreKeys, ...manualScoreKeys]),
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
                        evalKey: evalMeta.key,
                        evalCase,
                        globalTraceDisplay,
                        globalColumns: config.columns,
                        globalDeriveFromTracing: config.deriveFromTracing,
                        llmCallsConfig,
                        apiCallsConfig,
                        globalRemoveDefaultConfig: config.removeDefaultConfig,
                        trial,
                        startTime,
                        cacheAdapter:
                          bufferedCacheStore ??
                          (cacheEnabled ? cacheStore : null),
                        cacheMode,
                        moduleIsolation,
                        evalFilePath,
                        evalFileRelativePath: evalMeta.filePath,
                        workspaceRoot,
                        artifactDir: join(runDir, 'artifacts'),
                        runId: runState.manifest.id,
                      });

                      return {
                        caseDetail,
                        caseRow: {
                          caseId: evalCase.id,
                          evalId: evalMeta.id,
                          evalKey: evalMeta.key,
                          caseKey: caseDetail.caseKey,
                          tags: caseDetail.tags,
                          status: caseRowUpdate.status ?? 'pending',
                          durationMs: caseRowUpdate.durationMs ?? null,
                          cacheHits: caseRowUpdate.cacheHits ?? 0,
                          cacheOperations: caseRowUpdate.cacheOperations ?? 0,
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
        });
      } catch (error) {
        console.error(`Error running eval ${evalMeta.id}:`, error);
        evalErrors.push({
          evalId: evalMeta.id,
          details: formatUnknownErrorDetails(error),
        });
        lastRunStatusMap.set(evalMeta.key, 'error');
        latestRunInfoMap.set(evalMeta.key, {
          status: 'error',
          startedAt: runState.manifest.endedAt ?? runState.manifest.startedAt,
          commitSha: runState.manifest.commitSha ?? null,
          evalSourceFingerprint:
            runState.manifest.evalSourceFingerprints[evalMeta.key] ?? null,
        });
      }
    }

    const ambiguousCaseTargets =
      request.target.caseIds && request.target.caseIds.length > 0
        ? findAmbiguousTargetCaseIds(preparedEvals)
        : [];
    if (ambiguousCaseTargets.length > 0) {
      queuedCases.length = 0;
      evalErrors.push({
        evalId: 'target',
        details: `Ambiguous --case target. Narrow it with --file and/or --eval: ${ambiguousCaseTargets.join('; ')}`,
      });
    } else {
      await executeQueuedCases({
        queuedCases,
        concurrency: getConfiguredConcurrency(),
        globalTraceDisplay: config.traceDisplay,
      });
    }

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

      lastRunStatusMap.set(
        preparedEval.evalMeta.key,
        toLastRunStatus(
          deriveStatusFromCaseRows({ caseRows: preparedEval.evalCaseRows }),
        ),
      );
      const latestStatus =
        lastRunStatusMap.get(preparedEval.evalMeta.key) ?? null;
      latestRunInfoMap.set(preparedEval.evalMeta.key, {
        status: latestStatus,
        startedAt: runState.manifest.endedAt ?? runState.manifest.startedAt,
        commitSha: runState.manifest.commitSha ?? null,
        evalSourceFingerprint:
          runState.manifest.evalSourceFingerprints[preparedEval.evalMeta.key] ??
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
      evalErrors.length > 0 ? buildRunErrorMessage(evalErrors) : null;

    for (const evalKey of getTargetEvalKeys({
      request,
      sortedEvals: getSortedEvalMetas(),
    })) {
      const latestStatus =
        lastRunStatusMap.get(evalKey) ??
        toLastRunStatus(
          deriveStatusFromCaseRows({
            caseRows: [],
            lifecycleStatus: runState.manifest.status,
          }),
        );
      latestRunInfoMap.set(evalKey, {
        status: latestStatus,
        startedAt: completedRunAt,
        commitSha: runState.manifest.commitSha ?? null,
        evalSourceFingerprint:
          runState.manifest.evalSourceFingerprints[evalKey] ?? null,
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
        payload: { message: buildRunErrorMessage(evalErrors) },
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
    const message = formatUnknownErrorDetails(error);
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
