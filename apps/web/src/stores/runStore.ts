import {
  caseDetailSchema,
  caseRowSchema,
  configReloadStateSchema,
  runManifestSchema,
  runSummarySchema,
  type CacheMode,
  type CaseRow,
  type CreateRunRequest,
  type RunManifest,
  type RunSummary,
  type CaseDetail,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { Store } from 't-state';
import { createCollectionStore } from 'tsdf';
import { z } from 'zod';
import {
  apiClient,
  getRpcResult,
  getRpcResultUnwrap,
  type RpcResponseError,
} from '#src/api/client';
import {
  getCurrentSearchParams,
  updateSearchParams,
} from '#src/hooks/useSearchParams';
import { dataStoreManager } from '#src/stores/dataStoreManager';
import {
  evalSummariesStore,
  invalidateEvalSummaries,
} from '#src/stores/evalsStore';
import { invalidateRunHistory } from '#src/stores/historyStore';
import {
  getWorkspaceConfig,
  setConfigReloadState,
} from '#src/stores/workspaceConfigStore';
import { apiUrl } from '#src/utils/apiUrl';

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
const promoteRunResponseSchema = z.object({
  promoted: z.boolean(),
  run: createRunResponseSchema,
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
type CaseDetailPayload = { runId: string; caseId: string };
type RunDetailPayload = { runId: string };

type RunState = {
  currentRun: RunDetail | null;
  runStartError: string | null;
  selectedCaseRunId: string | null;
  selectedCaseId: string | null;
  selectedRunId: string | null;
  selectedRunScope: RunScope | null;
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
  });
}

export function clearDrawerSelectionState(): void {
  runStore.setPartialState({
    selectedCaseRunId: null,
    selectedCaseId: null,
    selectedRunId: null,
    selectedRunScope: null,
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

export const caseDetailStore = createCollectionStore<
  CaseDetail,
  CaseDetailPayload
>({
  id: 'collection-case-details',
  storeManager: dataStoreManager,
  usesRealTimeUpdates: true,
  getCollectionItemKey: (payload) => [payload.runId, payload.caseId],
  fetchFn: async (payload, signal) => {
    return getRpcResultUnwrap(
      apiClient.api.runs[':runId'].cases[':caseId'].$get(
        {
          param: {
            runId: encodeURIComponent(payload.runId),
            caseId: encodeURIComponent(payload.caseId),
          },
        },
        { init: { signal } },
      ),
    );
  },
});

export const runDetailStore = createCollectionStore<
  RunDetail,
  RunDetailPayload
>({
  id: 'collection-run-details',
  storeManager: dataStoreManager,
  usesRealTimeUpdates: true,
  getCollectionItemKey: (payload) => payload.runId,
  fetchFn: async (payload, signal) => {
    return getRpcResultUnwrap(
      apiClient.api.runs[':runId'].$get(
        { param: { runId: encodeURIComponent(payload.runId) } },
        { init: { signal } },
      ),
    );
  },
});

type RunInvalidationPriority = Parameters<
  typeof runDetailStore.invalidateItem
>[1];

function invalidateRunDerivedData(priority?: RunInvalidationPriority): void {
  invalidateRunHistory(priority);
  invalidateEvalSummaries(priority);
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
    runStartError: null,
    selectedCaseRunId: initialCaseSelection?.runId ?? null,
    selectedCaseId: initialCaseSelection?.caseId ?? null,
    selectedRunId: initialRunSelection?.runId ?? null,
    selectedRunScope: initialRunSelection?.scope ?? null,
    trials: 1,
    eventSource: null,
  },
});

export function clearRunStartError(): void {
  runStore.setPartialState({ runStartError: null });
}

export type RunTarget =
  | { mode: 'all' }
  | {
      mode: 'evalIds';
      evalIds?: string[];
      evalKeys?: string[];
      files?: string[];
      tagsFilter?: string[];
    }
  | {
      mode: 'caseIds';
      caseIds: string[];
      evalIds?: string[];
      evalKeys?: string[];
      files?: string[];
      tagsFilter?: string[];
    };

/** Optional run-start options, notably the cache mode. */
export type StartRunOptions = {
  cacheMode?: CacheMode;
  temporary?: boolean;
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
const genericErrorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
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
  const evals = evalSummariesStore.store.state.data ?? [];
  if (target.mode === 'evalIds') {
    return new Set(target.evalKeys ?? target.evalIds ?? target.files ?? [])
      .size;
  }
  if (target.mode === 'caseIds') {
    const evalTargets = target.evalKeys ?? target.evalIds ?? target.files;
    return evalTargets && evalTargets.length > 0
      ? new Set(evalTargets).size
      : evals.length;
  }
  return evals.length;
}

function confirmLargeAppRun(target: RunTarget): boolean {
  const evalCount = getRunTargetEvalCount(target);
  if (evalCount <= LARGE_APP_RUN_CONFIRM_EVAL_COUNT) return true;
  return window.confirm(
    `Run ${String(evalCount)} evals? This may take a while and can spend tokens or call external services.`,
  );
}

function handleStartRunError(error: RpcResponseError): StartRunResult {
  const validationParse = manualInputValidationErrorBodySchema.safeParse(
    error.response,
  );
  if (validationParse.success) {
    return {
      status: 'manual-input-error',
      failures: validationParse.data.failures,
    };
  }
  const configReloadParse = configReloadPendingErrorBodySchema.safeParse(
    error.response,
  );
  if (configReloadParse.success) {
    setConfigReloadState(configReloadParse.data.configReload);
    runStore.setPartialState({ runStartError: configReloadParse.data.error });
    return {
      status: 'config-reload-pending',
      message: configReloadParse.data.error,
    };
  }
  const genericErrorParse = genericErrorBodySchema.safeParse(error.response);

  const message = genericErrorParse.success
    ? (genericErrorParse.data.message ?? genericErrorParse.data.error)
    : error.message || `Server responded ${String(error.status)}`;
  runStore.setPartialState({ runStartError: message });
  return { status: 'error', message };
}

export async function startRun(
  target: RunTarget,
  options: StartRunOptions = {},
): Promise<StartRunResult> {
  clearRunStartError();
  if (getWorkspaceConfig().configReload.status !== 'idle') {
    const message = 'Config is reloading. Try again after it finishes.';
    runStore.setPartialState({ runStartError: message });
    return { status: 'config-reload-pending', message };
  }

  if (!confirmLargeAppRun(target)) return { status: 'cancelled' };

  const { trials } = runStore.state;
  const cacheMode = options.cacheMode ?? 'use';
  const body: CreateRunRequest = { target, trials, cache: { mode: cacheMode } };
  if (options.temporary === true) body.temporary = true;
  if (options.manualInputs) body.manualInputs = options.manualInputs;

  const runResult = await getRpcResult(
    apiClient.api.runs.$post({ json: body }),
  );
  if (runResult.error) {
    return handleStartRunError(runResult.error);
  }

  const parseResult = resultify(() =>
    createRunResponseSchema.parse(runResult.value),
  );
  if (parseResult.error) {
    const message = 'Run response did not match schema';
    runStore.setPartialState({ runStartError: message });
    return { status: 'error', message };
  }

  runStore.setPartialState({
    currentRun: parseResult.value,
    runStartError: null,
  });
  runDetailStore.addItemToState(
    { runId: parseResult.value.manifest.id },
    parseResult.value,
  );
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

function getCaseRowIdentity(caseRow: CaseRow): string {
  return caseRow.caseKey ?? caseRow.caseId;
}

function updateCachedRunStatus(params: {
  runId: string;
  status: RunManifest['status'];
  summary?: RunSummary;
  errorMessage?: string;
}): void {
  runDetailStore.updateItemState({ runId: params.runId }, (draft) => {
    draft.manifest.status = params.status;
    draft.summary.status = params.status;
    if (params.summary !== undefined) draft.summary = params.summary;
    if (params.errorMessage !== undefined) {
      draft.summary.errorMessage = params.errorMessage;
    }
  });
}

function updateCachedRunCase(runId: string, caseRow: CaseRow): void {
  runDetailStore.updateItemState({ runId }, (draft) => {
    const nextCases = draft.cases.map((current) =>
      getCaseRowIdentity(current) === getCaseRowIdentity(caseRow) &&
      current.trial === caseRow.trial
        ? caseRow
        : current,
    );
    const hasCase = nextCases.some(
      (current) =>
        getCaseRowIdentity(current) === getCaseRowIdentity(caseRow) &&
        current.trial === caseRow.trial,
    );
    draft.cases = hasCase ? nextCases : [...nextCases, caseRow];
  });
}

function invalidateCaseDetailForRow(runId: string, caseRow: CaseRow): void {
  const caseIdentity = getCaseRowIdentity(caseRow);
  caseDetailStore.invalidateItem(
    (payload) => payload.runId === runId && payload.caseId === caseIdentity,
    'realtimeUpdate',
  );
}

function subscribeToRunEvents(runId: string): void {
  const existing = runStore.state.eventSource;
  if (existing) existing.close();

  const es = new EventSource(apiUrl(`/api/runs/${runId}/events`));
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
    runDetailStore.updateItemState({ runId }, (draft) => {
      draft.summary = envelope.payload;
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
    updateCachedRunCase(runId, envelope.payload);
    invalidateCaseDetailForRow(runId, envelope.payload);
  }

  es.addEventListener('case.updated', (e) => applyCaseUpdate(e.data));
  es.addEventListener('case.started', (e) => applyCaseUpdate(e.data));
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
    updateCachedRunStatus({
      runId,
      status: 'completed',
      summary: envelope?.payload,
    });
    runDetailStore.invalidateItem({ runId }, 'realtimeUpdate');
    invalidateRunDerivedData('realtimeUpdate');
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
        eventSource: null,
      };
    });
    es.close();
    updateCachedRunStatus({ runId, status: 'cancelled' });
    runDetailStore.invalidateItem({ runId }, 'realtimeUpdate');
    invalidateRunDerivedData('realtimeUpdate');
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
        eventSource: null,
      };
    });
    es.close();
    updateCachedRunStatus({
      runId,
      status: 'error',
      errorMessage: envelope?.payload.message,
    });
    runDetailStore.invalidateItem({ runId }, 'realtimeUpdate');
    invalidateRunDerivedData('realtimeUpdate');
  });
}

export async function cancelRun(runId?: string): Promise<void> {
  const targetRunId = runId ?? runStore.state.currentRun?.manifest.id;
  if (!targetRunId) return;
  const cancelResult = await getRpcResult(
    apiClient.api.runs[':runId'].cancel.$post({
      param: { runId: encodeURIComponent(targetRunId) },
    }),
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
    eventSource: null,
  }));
  updateCachedRunStatus({ runId: targetRunId, status: 'cancelled' });
  runDetailStore.invalidateItem({ runId: targetRunId });
  invalidateRunDerivedData();
}

export function selectCase(runId: string, caseId: string): void {
  setCaseSelection({ runId, caseId });
  setRunSelectionState(null);
}

export function syncCaseSelectionFromSearchParams(
  searchParams: URLSearchParams,
): void {
  const selection = readCaseSelectionFromSearchParams(searchParams);

  if (!selection) {
    const caseIsAlreadyClosed =
      runStore.state.selectedCaseRunId === null &&
      runStore.state.selectedCaseId === null;
    if (caseIsAlreadyClosed) return;
    setCaseSelectionState(null);
    return;
  }

  const sameSelection =
    runStore.state.selectedCaseRunId === selection.runId &&
    runStore.state.selectedCaseId === selection.caseId;

  if (!sameSelection) {
    setCaseSelectionState(selection);
    runStore.setPartialState({ selectedRunId: null, selectedRunScope: null });
  }
}

export function closeCase(): void {
  setCaseSelection(null);
}

export function selectRun(runId: string, scope: RunScope | null = null): void {
  setRunSelection({ runId, scope });
  setCaseSelectionState(null);
}

export function closeRun(): void {
  setRunSelection(null);
}

export function syncRunSelectionFromSearchParams(
  searchParams: URLSearchParams,
): void {
  const caseSelection = readCaseSelectionFromSearchParams(searchParams);
  if (caseSelection) {
    const runIsAlreadyClosed =
      runStore.state.selectedRunId === null &&
      runStore.state.selectedRunScope === null;
    if (runIsAlreadyClosed) return;
    setRunSelectionState(null);
    return;
  }

  const selection = readRunSelectionFromSearchParams(searchParams);
  if (!selection) {
    const runIsAlreadyClosed =
      runStore.state.selectedRunId === null &&
      runStore.state.selectedRunScope === null;
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
}

export function setTrials(trials: number): void {
  runStore.setPartialState({ trials });
}

/**
 * Delete cache entries recorded by saved runs for a single exact eval identity.
 */
export async function clearCacheForEval(evalKey: string): Promise<void> {
  await getRpcResult(
    apiClient.api.cache.actions.eval.$delete({ query: { evalKey } }),
  );
}

export async function recomputeStatusesForEval(evalId: string): Promise<void> {
  await getRpcResult(
    apiClient.api.runs.actions['recompute-status'][':evalId'].$post({
      param: { evalId: encodeURIComponent(evalId) },
    }),
  );
  closeRun();
  closeCase();
  invalidateRunDerivedData();
}

export async function updateManualScore(params: {
  runId: string;
  caseId: string;
  scoreKey: string;
  value: number | null;
}): Promise<void> {
  const result = await getRpcResult(
    apiClient.api.runs[':runId'].cases[':caseId']['manual-scores'][
      ':scoreKey'
    ].$patch({
      param: {
        runId: encodeURIComponent(params.runId),
        caseId: encodeURIComponent(params.caseId),
        scoreKey: encodeURIComponent(params.scoreKey),
      },
      json: { value: params.value },
    }),
  );
  if (result.error) return;
  const parseResult = resultify(() =>
    updateManualScoreResponseSchema.parse(result.value),
  );
  if (parseResult.error) return;
  if (runStore.state.currentRun?.manifest.id === params.runId) {
    runStore.setPartialState({ currentRun: parseResult.value.run });
  }

  runDetailStore.addItemToState({ runId: params.runId }, parseResult.value.run);
  caseDetailStore.addItemToState(
    { runId: params.runId, caseId: params.caseId },
    parseResult.value.caseDetail,
  );
  invalidateRunDerivedData();
}

export async function recalculateDerivedAttributesForCase(params: {
  runId: string;
  caseId: string;
}): Promise<void> {
  const result = await getRpcResult(
    apiClient.api.runs[':runId'].cases[':caseId'].actions[
      'recalculate-derived-attributes'
    ].$post({
      param: {
        runId: encodeURIComponent(params.runId),
        caseId: encodeURIComponent(params.caseId),
      },
    }),
  );
  if (result.error) return;
  const parseResult = resultify(() =>
    recalculateDerivedAttributesResponseSchema.parse(result.value),
  );
  if (parseResult.error) return;

  caseDetailStore.addItemToState(
    { runId: params.runId, caseId: params.caseId },
    parseResult.value.caseDetail,
  );
}

export async function cleanRunsForEval(evalId: string): Promise<void> {
  await getRpcResult(
    apiClient.api.runs.actions.clean[':evalId'].$post({
      param: { evalId: encodeURIComponent(evalId) },
    }),
  );
  closeRun();
  closeCase();
  invalidateRunDerivedData();
}

/**
 * Delete a persisted run from disk and close any open drawers scoped to it.
 *
 * Server refuses to delete in-flight runs. Refreshes history and eval summaries
 * after the delete so affected aggregates (last run status, counts) update.
 */
export async function deleteRun(runId: string): Promise<void> {
  const result = await getRpcResult(
    apiClient.api.runs[':runId'].$delete({
      param: { runId: encodeURIComponent(runId) },
    }),
  );
  if (result.error) return;

  if (runStore.state.selectedRunId === runId) closeRun();
  if (runStore.state.selectedCaseRunId === runId) closeCase();
  runDetailStore.deleteItemState({ runId });
  caseDetailStore.deleteItemState((payload) => payload.runId === runId);

  invalidateRunDerivedData();
}

/**
 * Convert a temporary run into durable run history and refresh run-derived UI.
 */
export async function promoteRun(runId: string): Promise<void> {
  const result = await getRpcResult(
    apiClient.api.runs[':runId'].promote.$post({
      param: { runId: encodeURIComponent(runId) },
    }),
  );
  if (result.error) return;
  const parseResult = resultify(() =>
    promoteRunResponseSchema.parse(result.value),
  );
  if (parseResult.error) return;

  if (runStore.state.currentRun?.manifest.id === runId) {
    runStore.setPartialState({ currentRun: parseResult.value.run });
  }
  runDetailStore.addItemToState({ runId }, parseResult.value.run);
  invalidateRunDerivedData();
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
      getRpcResult(
        apiClient.api.runs[':runId'].$delete({
          param: { runId: encodeURIComponent(runId) },
        }),
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

  runDetailStore.deleteItemState((payload) => runIdSet.has(payload.runId));
  caseDetailStore.deleteItemState((payload) => runIdSet.has(payload.runId));
  invalidateRunDerivedData();
}
