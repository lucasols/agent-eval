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
  ColumnDef,
  CellValue,
  ColumnKind,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import { cellValueSchema } from '@agent-evals/shared';
import {
  getEvalRegistry,
  runInEvalScope,
  buildTraceTree,
  EvalAssertionError,
  type EvalColumnOverride,
  type EvalDefinition,
  type EvalScoreDef,
} from '@agent-evals/sdk';
import { loadConfig } from './config.ts';
import {
  getSpanCacheStatus,
  resolveTracePresentation,
} from './traceDisplay.ts';

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
  getRun(id: string):
    | { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] }
    | undefined;
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
  columnDefs: ColumnDef[];
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
  const evals = new Map<string, EvalMeta>();
  const staleEvals = new Set<string>();
  const runs = new Map<string, RunState>();
  const lastRunStatusMap = new Map<string, EvalSummary['lastRunStatus']>();

  const runner: EvalRunner = {
    async init() {
      config = await loadConfig();
      workspaceRoot = config.workspaceRoot ?? process.cwd();
      localStateDir = resolve(workspaceRoot, '.agent-evals');

      await mkdir(localStateDir, { recursive: true });
      await mkdir(join(localStateDir, 'runs'), { recursive: true });

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
              typeof evalDef.cases === 'function'
                ? await evalDef.cases()
                : evalDef.cases ?? [];

            runState.summary.totalCases += cases.length * request.trials;

            const accumulatedColumns = new Map<string, ColumnDef>();

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

                emitEvent(runState, {
                  type: 'case.finished',
                  runId: runState.manifest.id,
                  timestamp: new Date().toISOString(),
                  payload: caseRow,
                });

                allCaseRows.push(caseRow);
              }
            }

            evalMeta.columnDefs = [...accumulatedColumns.values()];
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

      const casesJsonl = allCaseRows.map((c) => JSON.stringify(c)).join('\n');
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

async function runCase<TInput>(params: {
  evalDef: EvalDefinition<TInput>;
  evalId: string;
  evalCase: { id: string; input: TInput; tags?: string[] };
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
  trial: number;
  signal: AbortSignal;
  startTime: number;
}): Promise<{
  caseDetail: CaseDetail;
  caseRowUpdate: Partial<CaseRow>;
}> {
  const {
    evalDef,
    evalId,
    evalCase,
    globalTraceDisplay,
    trial,
    signal,
    startTime,
  } = params;

  const { scope, error: executeError } = await runInEvalScope(
    evalCase.id,
    async () => {
      await evalDef.execute({ input: evalCase.input, signal });
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
    { value: number; passThreshold: number | undefined; label: string | undefined }
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

  const cacheHits = scope.spans.filter(
    (s) => getSpanCacheStatus(s) === 'hit',
  ).length;
  const cacheMisses = scope.spans.filter(
    (s) => {
      const cacheStatus = getSpanCacheStatus(s);
      return cacheStatus !== undefined && cacheStatus !== 'hit';
    },
  ).length;
  const cacheStatus: CaseRow['cacheStatus'] =
    cacheHits > 0 && cacheMisses === 0
      ? 'hit'
      : cacheHits > 0
        ? 'partial'
        : cacheMisses > 0
          ? 'miss'
          : null;

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
    cost: {
      totalUsd: costUsd,
      uncachedUsd: null,
      savingsUsd: null,
    },
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
    cacheStatus,
    columns,
  };

  return { caseDetail, caseRowUpdate };
}

function normalizeScoreDef<TInput>(
  def: EvalScoreDef<TInput>,
): {
  compute: (ctx: {
    input: TInput;
    outputs: Record<string, unknown>;
    case: { id: string; input: TInput; tags?: string[] };
  }) => number | Promise<number>;
  passThreshold: number | undefined;
  label: string | undefined;
} {
  if (typeof def === 'function') {
    return { compute: def, passThreshold: undefined, label: undefined };
  }
  return {
    compute: def.compute,
    passThreshold: def.passThreshold,
    label: def.label,
  };
}

function mergeColumnDefs<TInput>(
  target: Map<string, ColumnDef>,
  columns: Record<string, CellValue>,
  overrides: Record<string, EvalColumnOverride> | undefined,
  scores: Record<string, EvalScoreDef<TInput>> | undefined,
): void {
  const scoreKeys = new Set(Object.keys(scores ?? {}));
  const overrideMap = overrides ?? {};

  for (const [key, value] of Object.entries(columns)) {
    if (target.has(key)) continue;
    const override = overrideMap[key];
    const kind: ColumnKind = override?.kind ?? inferKind(value);
    const def: ColumnDef = {
      key,
      label: override?.label ?? key,
      kind,
    };
    if (override?.format !== undefined) def.format = override.format;
    if (override?.primary !== undefined) def.primary = override.primary;
    if (override?.defaultVisible !== undefined)
      def.defaultVisible = override.defaultVisible;
    if (override?.sortable !== undefined) def.sortable = override.sortable;
    if (override?.align !== undefined) def.align = override.align;
    if (scoreKeys.has(key)) {
      def.isScore = true;
      const scoreDef = scores?.[key];
      if (scoreDef && typeof scoreDef !== 'function') {
        if (scoreDef.passThreshold !== undefined) {
          def.passThreshold = scoreDef.passThreshold;
        }
        if (scoreDef.label !== undefined && override?.label === undefined) {
          def.label = scoreDef.label;
        }
      }
    }
    target.set(key, def);
  }
}

function inferKind(value: unknown): ColumnKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'blocks';
  return 'string';
}

function toCellValue(value: unknown): CellValue | undefined {
  if (value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const parsed = cellValueSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    return JSON.stringify(value);
  }
  if (value === undefined) return undefined;
  return JSON.stringify(value);
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
