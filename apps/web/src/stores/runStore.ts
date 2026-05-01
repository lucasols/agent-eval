import {
  caseDetailSchema,
  caseRowSchema,
  configReloadStateSchema,
  runManifestSchema,
  runSummarySchema,
  type CacheMode,
  type CaseRow,
  type RunManifest,
  type RunSummary,
  type CaseDetail,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { Store } from 't-state';
import { z } from 'zod/v4';
import {
  getCurrentSearchParams,
  updateSearchParams,
} from '#src/hooks/useSearchParams';
import { evalsStore, fetchEvals } from '#src/stores/evalsStore';
import { refetchHistory } from '#src/stores/historyStore';
import { workspaceConfigStore } from '#src/stores/workspaceConfigStore';

const createRunResponseSchema = z.object({
  manifest: runManifestSchema,
  summary: runSummarySchema,
  cases: z.array(caseRowSchema),
});
const updateManualScoreResponseSchema = z.object({
  updated: z.literal(true),
  run: createRunResponseSchema,
  caseDetail: caseDetailSchema,
});
const recalculateDerivedAttributesResponseSchema = z.object({
  updated: z.literal(true),
  caseDetail: caseDetailSchema,
});

const runSummaryEnvelopeSchema = z.object({ payload: runSummarySchema });
const caseRowEnvelopeSchema = z.object({ payload: caseRowSchema });
const runErrorEnvelopeSchema = z.object({
  payload: z.object({ message: z.string() }),
});

export type RunDetail = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
};

type CaseSelection = { runId: string; caseId: string };
type RunScope = { kind: 'eval'; id: string } | { kind: 'folder'; path: string };
type RunSelection = { runId: string; scope: RunScope | null };

type RunState = {
  currentRun: RunDetail | null;
  selectedCaseRunId: string | null;
  selectedCaseId: string | null;
  selectedCaseDetail: CaseDetail | null;
  selectedRunId: string | null;
  selectedRunScope: RunScope | null;
  selectedRunDetail: RunDetail | null;
  trials: number;
  eventSource: EventSource | null;
};

function readCaseSelectionFromSearchParams(
  searchParams: URLSearchParams,
): CaseSelection | null {
  const runId = searchParams.get('caseRun');
  const caseId = searchParams.get('case');
  if (!runId || !caseId) return null;
  return { runId, caseId };
}

function readRunSelectionFromSearchParams(
  searchParams: URLSearchParams,
): RunSelection | null {
  const runId = searchParams.get('run');
  if (!runId) return null;
  const runEval = searchParams.get('runEval');
  if (runEval) return { runId, scope: { kind: 'eval', id: runEval } };
  const runFolder = searchParams.get('runFolder');
  if (runFolder) {
    return { runId, scope: { kind: 'folder', path: runFolder } };
  }
  return { runId, scope: null };
}

function sameRunScope(left: RunScope | null, right: RunScope | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  if (left.kind === 'eval' && right.kind === 'eval')
    return left.id === right.id;
  if (left.kind === 'folder' && right.kind === 'folder') {
    return left.path === right.path;
  }
  return false;
}

function setCaseSelectionState(selection: CaseSelection | null): void {
  runStore.setPartialState({
    selectedCaseRunId: selection?.runId ?? null,
    selectedCaseId: selection?.caseId ?? null,
    selectedCaseDetail: null,
  });
}

export function clearDrawerSelectionState(): void {
  runStore.setPartialState({
    selectedCaseRunId: null,
    selectedCaseId: null,
    selectedCaseDetail: null,
    selectedRunId: null,
    selectedRunScope: null,
    selectedRunDetail: null,
  });
}

function setCaseSelection(selection: CaseSelection | null): void {
  setCaseSelectionState(selection);
  updateSearchParams((searchParams) => {
    searchParams.delete('caseRun');
    searchParams.delete('case');
    searchParams.delete('run');
    searchParams.delete('runEval');
    searchParams.delete('runFolder');
    searchParams.delete('span');
    if (!selection) {
      searchParams.delete('caseTab');
    }
    if (!selection) return;
    searchParams.set('caseRun', selection.runId);
    searchParams.set('case', selection.caseId);
  });
}

function setRunSelectionState(selection: RunSelection | null): void {
  runStore.setPartialState({
    selectedRunId: selection?.runId ?? null,
    selectedRunScope: selection?.scope ?? null,
    selectedRunDetail: null,
  });
}

function setRunSelection(selection: RunSelection | null): void {
  setRunSelectionState(selection);
  updateSearchParams((searchParams) => {
    searchParams.delete('run');
    searchParams.delete('runEval');
    searchParams.delete('runFolder');
    searchParams.delete('caseRun');
    searchParams.delete('case');
    searchParams.delete('caseTab');
    searchParams.delete('span');
    if (!selection) return;
    searchParams.set('run', selection.runId);
    if (selection.scope?.kind === 'eval') {
      searchParams.set('runEval', selection.scope.id);
    } else if (selection.scope?.kind === 'folder') {
      searchParams.set('runFolder', selection.scope.path);
    }
  });
}

async function fetchCaseDetail(runId: string, caseId: string): Promise<void> {
  const fetchResult = await resultify(() =>
    fetch(
      `/api/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}`,
    ),
  );
  if (fetchResult.error) return;
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return;
  const parseResult = resultify(() => caseDetailSchema.parse(jsonResult.value));
  if (parseResult.error) return;

  if (
    runStore.state.selectedCaseRunId !== runId ||
    runStore.state.selectedCaseId !== caseId
  ) {
    return;
  }

  runStore.setPartialState({ selectedCaseDetail: parseResult.value });
}

async function fetchRunDetail(runId: string): Promise<void> {
  const fetchResult = await resultify(() => fetch(`/api/runs/${runId}`));
  if (fetchResult.error) return;
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return;
  const parseResult = resultify(() =>
    createRunResponseSchema.parse(jsonResult.value),
  );
  if (parseResult.error) return;

  if (runStore.state.selectedRunId !== runId) return;
  runStore.setPartialState({ selectedRunDetail: parseResult.value });
}

const initialSearchParams = getCurrentSearchParams();
const initialCaseSelection =
  readCaseSelectionFromSearchParams(initialSearchParams);
const initialRunSelection =
  initialCaseSelection === null
    ? readRunSelectionFromSearchParams(initialSearchParams)
    : null;

export const runStore = new Store<RunState>({
  state: {
    currentRun: null,
    selectedCaseRunId: initialCaseSelection?.runId ?? null,
    selectedCaseId: initialCaseSelection?.caseId ?? null,
    selectedCaseDetail: null,
    selectedRunId: initialRunSelection?.runId ?? null,
    selectedRunScope: initialRunSelection?.scope ?? null,
    selectedRunDetail: null,
    trials: 1,
    eventSource: null,
  },
});

export type RunTarget =
  | { mode: 'all' }
  | {
      mode: 'evalIds';
      evalIds?: string[];
      evalKeys?: string[];
      files?: string[];
    };

/** Optional run-start options, notably the cache mode. */
export type StartRunOptions = {
  cacheMode?: CacheMode;
  /**
   * Manual-input payload keyed by eval key. Set when the user submitted the
   * `ManualInputModal` for a run that targets one or more evals declaring
   * `manualInput`. The server validates each entry against its eval schema.
   */
  manualInputs?: Record<string, unknown>;
};

const manualInputValidationFailureSchema = z.object({
  evalKey: z.string(),
  evalId: z.string(),
  reason: z.enum(['missing', 'invalid']),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});

const manualInputValidationErrorBodySchema = z.object({
  error: z.literal('Manual input validation failed'),
  failures: z.array(manualInputValidationFailureSchema),
});
const configReloadPendingErrorBodySchema = z.object({
  code: z.literal('CONFIG_RELOAD_PENDING'),
  error: z.string(),
  configReload: configReloadStateSchema,
});

/** Per-eval manual-input failure surfaced from a 400 `POST /api/runs` response. */
export type ManualInputStartRunFailure = z.infer<
  typeof manualInputValidationFailureSchema
>;

/** Result of {@link startRun}, including structured manual-input failures. */
export type StartRunResult =
  | { status: 'started' }
  | { status: 'cancelled' }
  | { status: 'config-reload-pending'; message: string }
  | { status: 'manual-input-error'; failures: ManualInputStartRunFailure[] }
  | { status: 'error'; message: string };

const LARGE_APP_RUN_CONFIRM_EVAL_COUNT = 5;

function getRunTargetEvalCount(target: RunTarget): number {
  if (target.mode === 'evalIds') {
    return new Set(target.evalKeys ?? target.evalIds ?? target.files ?? [])
      .size;
  }
  return evalsStore.state.evals.length;
}

function confirmLargeAppRun(target: RunTarget): boolean {
  const evalCount = getRunTargetEvalCount(target);
  if (evalCount <= LARGE_APP_RUN_CONFIRM_EVAL_COUNT) return true;
  return window.confirm(
    `Run ${String(evalCount)} evals? This may take a while and can spend tokens or call external services.`,
  );
}

export async function startRun(
  target: RunTarget,
  options: StartRunOptions = {},
): Promise<StartRunResult> {
  if (workspaceConfigStore.state.configReload.status !== 'idle') {
    return {
      status: 'config-reload-pending',
      message: 'Config is reloading. Try again after it finishes.',
    };
  }

  if (!confirmLargeAppRun(target)) return { status: 'cancelled' };

  const { trials } = runStore.state;
  const cacheMode = options.cacheMode ?? 'use';
  const body: Record<string, unknown> = {
    target,
    trials,
    cache: { mode: cacheMode },
  };
  if (options.manualInputs) body.manualInputs = options.manualInputs;

  const fetchResult = await resultify(() =>
    fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  if (fetchResult.error) {
    return { status: 'error', message: fetchResult.error.message };
  }

  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) {
    return { status: 'error', message: 'Server returned non-JSON response' };
  }

  if (!fetchResult.value.ok) {
    const validationParse = manualInputValidationErrorBodySchema.safeParse(
      jsonResult.value,
    );
    if (validationParse.success) {
      return {
        status: 'manual-input-error',
        failures: validationParse.data.failures,
      };
    }
    const configReloadParse = configReloadPendingErrorBodySchema.safeParse(
      jsonResult.value,
    );
    if (configReloadParse.success) {
      workspaceConfigStore.setPartialState({
        configReload: configReloadParse.data.configReload,
      });
      return {
        status: 'config-reload-pending',
        message: configReloadParse.data.error,
      };
    }
    return {
      status: 'error',
      message: `Server responded ${String(fetchResult.value.status)}`,
    };
  }

  const parseResult = resultify(() =>
    createRunResponseSchema.parse(jsonResult.value),
  );
  if (parseResult.error) {
    return { status: 'error', message: 'Run response did not match schema' };
  }

  runStore.setPartialState({ currentRun: parseResult.value });
  setCaseSelection(null);

  subscribeToRunEvents(parseResult.value.manifest.id);
  return { status: 'started' };
}

function safeJsonParse(raw: string): unknown {
  const parsed = resultify((): unknown => JSON.parse(raw));
  if (parsed.error) return null;
  return parsed.value;
}

function safeParseJson<T>(schema: z.ZodType<T>, raw: string): T | null {
  const json = safeJsonParse(raw);
  if (json === null) return null;
  const parsed = schema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

function subscribeToRunEvents(runId: string): void {
  const existing = runStore.state.eventSource;
  if (existing) existing.close();

  const es = new EventSource(`/api/runs/${runId}/events`);
  runStore.setPartialState({ eventSource: es });

  es.addEventListener('run.summary', (e) => {
    const envelope = safeParseJson(runSummaryEnvelopeSchema, e.data);
    if (!envelope) return;
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      return {
        ...prev,
        currentRun: { ...prev.currentRun, summary: envelope.payload },
      };
    });
  });

  function applyCaseUpdate(envelopeData: string): void {
    const envelope = safeParseJson(caseRowEnvelopeSchema, envelopeData);
    if (!envelope) return;
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      const cases = prev.currentRun.cases.map((c) =>
        (c.caseKey ?? c.caseId) ===
          (envelope.payload.caseKey ?? envelope.payload.caseId) &&
        c.trial === envelope.payload.trial
          ? envelope.payload
          : c,
      );
      const hasCase = cases.some(
        (c) =>
          (c.caseKey ?? c.caseId) ===
            (envelope.payload.caseKey ?? envelope.payload.caseId) &&
          c.trial === envelope.payload.trial,
      );
      return {
        ...prev,
        currentRun: {
          ...prev.currentRun,
          cases: hasCase ? cases : [...cases, envelope.payload],
        },
      };
    });
  }

  es.addEventListener('case.updated', (e) => applyCaseUpdate(e.data));
  es.addEventListener('case.finished', (e) => applyCaseUpdate(e.data));

  es.addEventListener('run.finished', (e) => {
    const envelope = safeParseJson(runSummaryEnvelopeSchema, e.data);
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      return {
        ...prev,
        currentRun: {
          ...prev.currentRun,
          summary: envelope?.payload ?? prev.currentRun.summary,
          manifest: { ...prev.currentRun.manifest, status: 'completed' },
        },
        eventSource: null,
      };
    });
    es.close();
    void refetchHistory();
    void fetchEvals();
  });

  es.addEventListener('run.cancelled', () => {
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      return {
        ...prev,
        currentRun: {
          ...prev.currentRun,
          summary: { ...prev.currentRun.summary, status: 'cancelled' },
          manifest: { ...prev.currentRun.manifest, status: 'cancelled' },
        },
        selectedRunDetail:
          prev.selectedRunDetail?.manifest.id === prev.currentRun.manifest.id
            ? {
                ...prev.selectedRunDetail,
                summary: {
                  ...prev.selectedRunDetail.summary,
                  status: 'cancelled',
                },
                manifest: {
                  ...prev.selectedRunDetail.manifest,
                  status: 'cancelled',
                },
              }
            : prev.selectedRunDetail,
        eventSource: null,
      };
    });
    es.close();
    void refetchHistory();
    void fetchEvals();
  });

  es.addEventListener('run.error', (e) => {
    const envelope = safeParseJson(runErrorEnvelopeSchema, e.data);
    if (envelope) {
      console.error('Run error:', envelope.payload.message);
    }
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      return {
        ...prev,
        currentRun: {
          ...prev.currentRun,
          manifest: { ...prev.currentRun.manifest, status: 'error' },
          summary: {
            ...prev.currentRun.summary,
            status: 'error',
            errorMessage:
              envelope?.payload.message ?? prev.currentRun.summary.errorMessage,
          },
        },
        selectedRunDetail:
          prev.selectedRunDetail?.manifest.id === prev.currentRun.manifest.id
            ? {
                ...prev.selectedRunDetail,
                manifest: {
                  ...prev.selectedRunDetail.manifest,
                  status: 'error',
                },
                summary: {
                  ...prev.selectedRunDetail.summary,
                  status: 'error',
                  errorMessage:
                    envelope?.payload.message ??
                    prev.selectedRunDetail.summary.errorMessage,
                },
              }
            : prev.selectedRunDetail,
        eventSource: null,
      };
    });
    es.close();
    void refetchHistory();
    void fetchEvals();
  });
}

export async function cancelRun(runId?: string): Promise<void> {
  const targetRunId = runId ?? runStore.state.currentRun?.manifest.id;
  if (!targetRunId) return;
  const cancelResult = await resultify(() =>
    fetch(`/api/runs/${targetRunId}/cancel`, { method: 'POST' }),
  );
  if (cancelResult.error) return;

  const eventSource = runStore.state.eventSource;
  if (eventSource) eventSource.close();

  runStore.setState((prev) => ({
    ...prev,
    currentRun:
      prev.currentRun?.manifest.id === targetRunId
        ? {
            ...prev.currentRun,
            manifest: { ...prev.currentRun.manifest, status: 'cancelled' },
            summary: { ...prev.currentRun.summary, status: 'cancelled' },
          }
        : prev.currentRun,
    selectedRunDetail:
      prev.selectedRunDetail?.manifest.id === targetRunId
        ? {
            ...prev.selectedRunDetail,
            manifest: {
              ...prev.selectedRunDetail.manifest,
              status: 'cancelled',
            },
            summary: { ...prev.selectedRunDetail.summary, status: 'cancelled' },
          }
        : prev.selectedRunDetail,
    eventSource: null,
  }));
  void refetchHistory();
  void fetchEvals();
}

export async function selectCase(runId: string, caseId: string): Promise<void> {
  setCaseSelection({ runId, caseId });
  setRunSelectionState(null);
  await fetchCaseDetail(runId, caseId);
}

export async function syncCaseSelectionFromSearchParams(
  searchParams: URLSearchParams,
): Promise<void> {
  const selection = readCaseSelectionFromSearchParams(searchParams);

  if (!selection) {
    const caseIsAlreadyClosed =
      runStore.state.selectedCaseRunId === null &&
      runStore.state.selectedCaseId === null &&
      runStore.state.selectedCaseDetail === null;
    if (caseIsAlreadyClosed) return;
    setCaseSelectionState(null);
    return;
  }

  const sameSelection =
    runStore.state.selectedCaseRunId === selection.runId &&
    runStore.state.selectedCaseId === selection.caseId;

  if (!sameSelection) {
    setCaseSelectionState(selection);
    runStore.setPartialState({
      selectedRunId: null,
      selectedRunScope: null,
      selectedRunDetail: null,
    });
  }

  if (sameSelection && runStore.state.selectedCaseDetail) return;
  await fetchCaseDetail(selection.runId, selection.caseId);
}

export function closeCase(): void {
  setCaseSelection(null);
}

export async function selectRun(
  runId: string,
  scope: RunScope | null = null,
): Promise<void> {
  setRunSelection({ runId, scope });
  setCaseSelectionState(null);
  await fetchRunDetail(runId);
}

export function closeRun(): void {
  setRunSelection(null);
}

export async function syncRunSelectionFromSearchParams(
  searchParams: URLSearchParams,
): Promise<void> {
  const caseSelection = readCaseSelectionFromSearchParams(searchParams);
  if (caseSelection) {
    const runIsAlreadyClosed =
      runStore.state.selectedRunId === null &&
      runStore.state.selectedRunScope === null &&
      runStore.state.selectedRunDetail === null;
    if (runIsAlreadyClosed) return;
    setRunSelectionState(null);
    return;
  }

  const selection = readRunSelectionFromSearchParams(searchParams);
  if (!selection) {
    const runIsAlreadyClosed =
      runStore.state.selectedRunId === null &&
      runStore.state.selectedRunScope === null &&
      runStore.state.selectedRunDetail === null;
    if (runIsAlreadyClosed) return;
    setRunSelectionState(null);
    return;
  }

  const sameSelection = runStore.state.selectedRunId === selection.runId;
  if (!sameSelection) {
    setRunSelectionState(selection);
    setCaseSelectionState(null);
  } else if (!sameRunScope(runStore.state.selectedRunScope, selection.scope)) {
    runStore.setPartialState({ selectedRunScope: selection.scope });
  }

  if (sameSelection && runStore.state.selectedRunDetail) return;
  await fetchRunDetail(selection.runId);
}

export function setTrials(trials: number): void {
  runStore.setPartialState({ trials });
}

/**
 * Delete cache entries scoped to a single authored eval id.
 *
 * Conventional cache namespaces use `${evalId}__${operationName}`, so duplicate
 * eval ids in different files share cache management when they use the same
 * authored keys.
 */
export async function clearCacheForEval(evalId: string): Promise<void> {
  const listResult = await resultify(() => fetch('/api/cache'));
  if (listResult.error) return;
  const jsonResult = await resultify(() => listResult.value.json());
  if (jsonResult.error) return;

  const parsed = z
    .array(z.object({ namespace: z.string(), key: z.string() }))
    .safeParse(jsonResult.value);
  if (!parsed.success) return;

  const prefix = `${evalId}__`;
  const matching = parsed.data.filter((entry) =>
    entry.namespace.startsWith(prefix),
  );
  await Promise.all(
    matching.map((entry) =>
      resultify(() =>
        fetch(
          `/api/cache/${encodeURIComponent(entry.namespace)}/${encodeURIComponent(entry.key)}`,
          { method: 'DELETE' },
        ),
      ),
    ),
  );
}

export async function recomputeStatusesForEval(evalId: string): Promise<void> {
  await resultify(() =>
    fetch(`/api/runs/actions/recompute-status/${encodeURIComponent(evalId)}`, {
      method: 'POST',
    }),
  );
  closeRun();
  closeCase();
  await refetchHistory();
  await fetchEvals();
}

export async function updateManualScore(params: {
  runId: string;
  caseId: string;
  scoreKey: string;
  value: number | null;
}): Promise<void> {
  const result = await resultify(() =>
    fetch(
      `/api/runs/${encodeURIComponent(params.runId)}/cases/${encodeURIComponent(params.caseId)}/manual-scores/${encodeURIComponent(params.scoreKey)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: params.value }),
      },
    ),
  );
  if (result.error) return;
  if (!result.value.ok) return;
  const jsonResult = await resultify(() => result.value.json());
  const parseResult = jsonResult.error
    ? null
    : updateManualScoreResponseSchema.safeParse(jsonResult.value);
  if (
    parseResult?.success &&
    runStore.state.currentRun?.manifest.id === params.runId
  ) {
    runStore.setPartialState({ currentRun: parseResult.data.run });
  }

  await refetchHistory();
  await fetchEvals();
  if (
    runStore.state.selectedCaseRunId === params.runId &&
    runStore.state.selectedCaseId === params.caseId
  ) {
    await fetchCaseDetail(params.runId, params.caseId);
  }
  if (runStore.state.selectedRunId === params.runId) {
    await fetchRunDetail(params.runId);
  }
}

export async function recalculateDerivedAttributesForCase(params: {
  runId: string;
  caseId: string;
}): Promise<void> {
  const result = await resultify(() =>
    fetch(
      `/api/runs/${encodeURIComponent(params.runId)}/cases/${encodeURIComponent(params.caseId)}/actions/recalculate-derived-attributes`,
      { method: 'POST' },
    ),
  );
  if (result.error) return;
  if (!result.value.ok) return;

  const jsonResult = await resultify(() => result.value.json());
  const parseResult = jsonResult.error
    ? null
    : recalculateDerivedAttributesResponseSchema.safeParse(jsonResult.value);
  if (!parseResult?.success) return;

  if (
    runStore.state.selectedCaseRunId === params.runId &&
    runStore.state.selectedCaseId === params.caseId
  ) {
    runStore.setPartialState({
      selectedCaseDetail: parseResult.data.caseDetail,
    });
  }
}

export async function cleanRunsForEval(evalId: string): Promise<void> {
  await resultify(() =>
    fetch(`/api/runs/actions/clean/${encodeURIComponent(evalId)}`, {
      method: 'POST',
    }),
  );
  closeRun();
  closeCase();
  await refetchHistory();
  await fetchEvals();
}

/**
 * Delete a persisted run from disk and close any open drawers scoped to it.
 *
 * Server refuses to delete in-flight runs. Refreshes history and eval summaries
 * after the delete so affected aggregates (last run status, counts) update.
 */
export async function deleteRun(runId: string): Promise<void> {
  const result = await resultify(() =>
    fetch(`/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }),
  );
  if (result.error) return;
  if (!result.value.ok) return;

  if (runStore.state.selectedRunId === runId) closeRun();
  if (runStore.state.selectedCaseRunId === runId) closeCase();

  await refetchHistory();
  await fetchEvals();
}

/**
 * Delete multiple persisted runs from disk and refresh run-derived UI state once.
 *
 * Server-side deletion still refuses in-flight runs; failed individual deletes
 * are ignored so the rest of the requested cleanup can proceed.
 */
export async function deleteRuns(runIds: string[]): Promise<void> {
  const runIdSet = new Set(runIds);
  if (runIdSet.size === 0) return;

  await Promise.all(
    Array.from(runIdSet, (runId) =>
      resultify(() =>
        fetch(`/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }),
      ),
    ),
  );

  if (
    runStore.state.currentRun &&
    runIdSet.has(runStore.state.currentRun.manifest.id)
  ) {
    runStore.setPartialState({ currentRun: null });
  }
  if (
    runStore.state.selectedRunId &&
    runIdSet.has(runStore.state.selectedRunId)
  ) {
    closeRun();
  }
  if (
    runStore.state.selectedCaseRunId &&
    runIdSet.has(runStore.state.selectedCaseRunId)
  ) {
    closeCase();
  }

  await refetchHistory();
  await fetchEvals();
}
