import { glob } from 'glob';
import { watch } from 'chokidar';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type {
  EvalSummary,
  RunManifest,
  RunSummary,
  CaseRow,
  CaseDetail,
  SseEnvelope,
  CreateRunRequest,
  AgentEvalsConfig,
} from '@agent-evals/shared';
import { getEvalRegistry, createTraceRecorder } from '@agent-evals/sdk';
import { loadConfig } from './config.ts';
import { createCacheManager } from './cache.ts';
import type { CacheManager } from './cache.ts';

export type EvalRunner = {
  init(): Promise<void>;
  getEvals(): EvalSummary[];
  getEval(id: string): EvalSummary | undefined;
  refreshDiscovery(): Promise<void>;
  startRun(request: CreateRunRequest): Promise<{
    manifest: RunManifest;
    summary: RunSummary;
    cases: CaseRow[];
  }>;
  getRuns(): RunManifest[];
  getRun(id: string): {
    manifest: RunManifest;
    summary: RunSummary;
    cases: CaseRow[];
  } | undefined;
  cancelRun(id: string): void;
  getCaseDetail(runId: string, caseId: string): CaseDetail | undefined;
  subscribe(runId: string, listener: (event: SseEnvelope) => void): () => void;
  getWorkspaceRoot(): string;
  getArtifactPath(artifactId: string): string | undefined;
};

type CreateRunnerOptions = {
  watchForChanges?: boolean;
};

type EvalMeta = {
  id: string;
  title?: string;
  description?: string;
  filePath: string;
  columnDefs: EvalSummary['columnDefs'];
  caseCount: number | null;
};

type RunState = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
  caseDetails: Map<string, CaseDetail>;
  listeners: Set<(event: SseEnvelope) => void>;
  abortController: AbortController;
};

export function createRunner({
  watchForChanges = true,
}: CreateRunnerOptions = {}): EvalRunner {
  let config: AgentEvalsConfig;
  let workspaceRoot: string;
  let localStateDir: string;
  let cacheManager: CacheManager;
  const evals = new Map<string, EvalMeta>();
  const staleEvals = new Set<string>();
  const runs = new Map<string, RunState>();
  const lastRunStatusMap = new Map<string, EvalSummary['lastRunStatus']>();

  const runner: EvalRunner = {
    async init() {
      config = await loadConfig();
      workspaceRoot = config.workspaceRoot ?? process.cwd();
      localStateDir = resolve(workspaceRoot, '.agent-evals');
      cacheManager = createCacheManager(join(localStateDir, 'cache'));

      await mkdir(localStateDir, { recursive: true });
      await mkdir(join(localStateDir, 'runs'), { recursive: true });
      await mkdir(join(localStateDir, 'cache'), { recursive: true });

      await runner.refreshDiscovery();
      if (watchForChanges) {
        setupWatcher();
      }
    },

    getEvals() {
      const result: EvalSummary[] = [];
      for (const meta of evals.values()) {
        result.push({
          id: meta.id,
          title: meta.title,
          description: meta.description,
          filePath: meta.filePath,
          stale: staleEvals.has(meta.id),
          columnDefs: meta.columnDefs,
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
        caseCount: meta.caseCount,
        lastRunStatus: lastRunStatusMap.get(meta.id) ?? null,
      };
    },

    async refreshDiscovery() {
      const patterns = config.include;
      const discovered: string[] = [];

      for (const pattern of patterns) {
        const files = await glob(pattern, { cwd: workspaceRoot, absolute: true });
        discovered.push(...files);
      }

      evals.clear();
      staleEvals.clear();

      for (const filePath of discovered) {
        try {
          const content = await readFile(filePath, 'utf-8');
          const meta = parseEvalMeta(filePath, content);
          if (meta) {
            evals.set(meta.id, meta);
          }
        } catch {
          // skip files that can't be parsed
        }
      }
    },

    async startRun(request) {
      const runId = generateRunId();
      const now = new Date().toISOString();

      const manifest: RunManifest = {
        id: runId,
        status: 'running',
        startedAt: now,
        endedAt: null,
        target: request.target,
        trials: request.trials,
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
        cost: { totalUsd: null, uncachedUsd: null, savingsUsd: null },
        errorMessage: null,
      };

      const abortController = new AbortController();

      const runState: RunState = {
        manifest,
        summary,
        cases: [],
        caseDetails: new Map(),
        listeners: new Set(),
        abortController,
      };

      runs.set(runId, runState);

      const runDir = join(localStateDir, 'runs', runId);
      await mkdir(runDir, { recursive: true });
      await mkdir(join(runDir, 'traces'), { recursive: true });
      await mkdir(join(runDir, 'artifacts'), { recursive: true });

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
      return {
        manifest: run.manifest,
        summary: run.summary,
        cases: run.cases,
      };
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

    getWorkspaceRoot() {
      return workspaceRoot;
    },

    getArtifactPath(artifactId_) {
      return undefined;
    },
  };

  function setupWatcher() {
    const patterns = config.include.map((p) => resolve(workspaceRoot, p));
    const watcher = watch(patterns, {
      ignoreInitial: true,
      persistent: true,
    });

    watcher.on('change', () => {
      for (const id of evals.keys()) {
        staleEvals.add(id);
      }
    });

    watcher.on('add', () => {
      void runner.refreshDiscovery();
    });

    watcher.on('unlink', () => {
      void runner.refreshDiscovery();
    });
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

      for (const evalMeta of targetEvals) {
        if (runState.abortController.signal.aborted) break;

        const evalFilePath = evalMeta.filePath;

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
            const cases =
              typeof evalDef.data === 'function'
                ? await evalDef.data()
                : evalDef.data;

            runState.summary.totalCases += cases.length * request.trials;

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
                  cacheStatus: null,
                  columns: evalCase.columns ?? {},
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

                try {
                  const { recorder, getSpans, buildTree } = createTraceRecorder(
                    evalCase.id,
                  );

                  const runtimeCtx = {
                    cache: cacheManager.createCacheRuntime(
                      request.disableCache ?? false,
                    ),
                    runId: runState.manifest.id,
                    workspaceRoot,
                    artifactsDir: join(runDir, 'artifacts', evalCase.id),
                  };

                  await mkdir(runtimeCtx.artifactsDir, { recursive: true });

                  const taskResult = await evalDef.task({
                    case: evalCase,
                    input: evalCase.input,
                    signal: runState.abortController.signal,
                    trace: recorder,
                    runtime: runtimeCtx,
                  });

                  const elapsedMs = Date.now() - startTime;
                  const traceTree = buildTree();
                  const spans = getSpans();

                  const totalCost = spans
                    .filter((s) => s.costUsd !== null && s.costUsd !== undefined)
                    .reduce((sum, s) => sum + (s.costUsd ?? 0), 0);

                  const cacheHits = spans.filter(
                    (s) => s.cache?.status === 'hit',
                  ).length;
                  const cacheMisses = spans.filter(
                    (s) => s.cache && s.cache.status !== 'hit',
                  ).length;
                  const cacheStatus =
                    cacheHits > 0 && cacheMisses === 0 ? ('hit' as const)
                    : cacheHits > 0 ? ('partial' as const)
                    : cacheMisses > 0 ? ('miss' as const)
                    : null;

                  const mergedColumns = {
                    ...evalCase.columns,
                    ...taskResult.columns,
                  };

                  const scores: CaseDetail['scores'] = [];
                  if (evalDef.scorers) {
                    for (const scorer of evalDef.scorers) {
                      try {
                        const scoreResult = await scorer({
                          case: evalCase,
                          input: evalCase.input,
                          output: taskResult.output,
                          trace: traceTree,
                          runtime: runtimeCtx,
                        });
                        scores.push(scoreResult);
                        if (scoreResult.columns) {
                          Object.assign(mergedColumns, scoreResult.columns);
                        }
                      } catch (e) {
                        scores.push({
                          id: 'scorer-error',
                          score: 0,
                          reason: e instanceof Error ? e.message : String(e),
                        });
                      }
                    }
                  }

                  const avgScore =
                    scores.length > 0
                      ? scores.reduce((sum, s) => sum + s.score, 0) /
                        scores.length
                      : null;

                  let passed = true;
                  if (
                    evalDef.passThreshold !== null &&
                    evalDef.passThreshold !== undefined
                  ) {
                    if (avgScore === null || avgScore < evalDef.passThreshold) {
                      passed = false;
                    }
                  }

                  if (evalDef.assert) {
                    try {
                      await evalDef.assert({
                        case: evalCase,
                        input: evalCase.input,
                        output: taskResult.output,
                        trace: traceTree,
                        scores,
                        cost: {
                          totalUsd: totalCost > 0 ? totalCost : null,
                          uncachedUsd: null,
                          savingsUsd: null,
                        },
                        columns: mergedColumns,
                      });
                    } catch {
                      passed = false;
                    }
                  }

                  caseRow.status = passed ? 'pass' : 'fail';
                  caseRow.score = avgScore;
                  caseRow.latencyMs = elapsedMs;
                  caseRow.costUsd = totalCost > 0 ? totalCost : null;
                  caseRow.cacheStatus = cacheStatus;
                  caseRow.columns = mergedColumns;

                  if (passed) {
                    runState.summary.passedCases++;
                  } else {
                    runState.summary.failedCases++;
                  }

                  const caseDetail: CaseDetail = {
                    caseId: evalCase.id,
                    evalId: evalMeta.id,
                    status: caseRow.status,
                    input: evalCase.input,
                    displayInput: evalCase.displayInput,
                    output: taskResult.output,
                    displayOutput: taskResult.displayOutput ?? [],
                    scores,
                    trace: spans,
                    cost: {
                      totalUsd: totalCost > 0 ? totalCost : null,
                      uncachedUsd: null,
                      savingsUsd: null,
                    },
                    columns: mergedColumns,
                    error: null,
                    trial,
                  };

                  runState.caseDetails.set(evalCase.id, caseDetail);

                  await writeFile(
                    join(runDir, 'traces', `${evalCase.id}.json`),
                    JSON.stringify(spans, null, 2),
                  );
                } catch (error) {
                  caseRow.status = 'error';
                  caseRow.latencyMs = Date.now() - startTime;
                  runState.summary.errorCases++;

                  const errorInfo =
                    error instanceof Error
                      ? {
                          name: error.name,
                          message: error.message,
                          stack: error.stack,
                        }
                      : { message: String(error) };

                  const caseDetail: CaseDetail = {
                    caseId: evalCase.id,
                    evalId: evalMeta.id,
                    status: 'error',
                    input: evalCase.input,
                    displayInput: evalCase.displayInput,
                    output: null,
                    displayOutput: [],
                    scores: [],
                    trace: [],
                    cost: { totalUsd: null, uncachedUsd: null, savingsUsd: null },
                    columns: evalCase.columns ?? {},
                    error: errorInfo,
                    trial,
                  };

                  runState.caseDetails.set(evalCase.id, caseDetail);
                }

                emitEvent(runState, {
                  type: 'case.finished',
                  runId: runState.manifest.id,
                  timestamp: new Date().toISOString(),
                  payload: caseRow,
                });

                allCaseRows.push(caseRow);
              }
            }
          });

          lastRunStatusMap.set(
            evalMeta.id,
            runState.summary.failedCases > 0 || runState.summary.errorCases > 0
              ? 'fail'
              : 'pass',
          );
        } catch (error) {
          console.error(`Error running eval ${evalMeta.id}:`, error);
          evalErrors.push({
            evalId: evalMeta.id,
            message: error instanceof Error ? error.message : String(error),
          });
          lastRunStatusMap.set(evalMeta.id, 'fail');
        }
      }

      const allScores = allCaseRows
        .map((c) => c.score)
        .filter((s): s is number => s !== null);
      runState.summary.averageScore =
        allScores.length > 0
          ? allScores.reduce((a, b) => a + b, 0) / allScores.length
          : null;

      const totalCostUsd = allCaseRows
        .map((c) => c.costUsd)
        .filter((c): c is number => c !== null)
        .reduce((a, b) => a + b, 0);

      runState.summary.cost.totalUsd = totalCostUsd > 0 ? totalCostUsd : null;

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

      await writeFile(
        join(runDir, 'summary.json'),
        JSON.stringify(runState.summary, null, 2),
      );

      await writeFile(
        join(runDir, 'run.json'),
        JSON.stringify(runState.manifest, null, 2),
      );

      const casesJsonl = allCaseRows
        .map((c) => JSON.stringify(c))
        .join('\n');
      await writeFile(join(runDir, 'cases.jsonl'), casesJsonl);
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

      await writeFile(
        join(runDir, 'summary.json'),
        JSON.stringify(runState.summary, null, 2),
      );
      await writeFile(
        join(runDir, 'run.json'),
        JSON.stringify(runState.manifest, null, 2),
      );
    }
  }

  function getTargetEvals(request: CreateRunRequest): EvalMeta[] {
    if (request.target.mode === 'all') {
      return [...evals.values()];
    }
    if (request.target.mode === 'evalIds' && request.target.evalIds) {
      return request.target.evalIds
        .map((id) => evals.get(id))
        .filter((e): e is EvalMeta => e !== undefined);
    }
    return [...evals.values()];
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

  return runner;
}

const defineEvalRegex = /defineEval(?:<[\s\S]*?>)?\s*\(\s*\{/;
const evalIdMatchRegex =
  /defineEval(?:<[\s\S]*?>)?\s*\(\s*\{[\s\S]*?\bid\s*:\s*['"]([^'"]+)['"]/;
const evalTitleMatchRegex =
  /defineEval(?:<[\s\S]*?>)?\s*\(\s*\{[\s\S]*?\btitle\s*:\s*['"]([^'"]+)['"]/;

function parseEvalMeta(filePath: string, content: string): EvalMeta | null {
  if (!defineEvalRegex.test(content)) return null;

  const idMatch = evalIdMatchRegex.exec(content);
  if (!idMatch?.[1]) return null;

  const titleMatch = evalTitleMatchRegex.exec(content);

  const result: EvalMeta = {
    id: idMatch[1],
    filePath,
    columnDefs: [],
    caseCount: null,
  };

  const title = titleMatch?.[1];
  if (title !== undefined) {
    result.title = title;
  }

  return result;
}

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${String(now.getUTCFullYear())}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}Z`;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}_${suffix}`;
}
