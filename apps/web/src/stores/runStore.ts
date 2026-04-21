import {
  caseDetailSchema,
  caseRowSchema,
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
} from '../hooks/useSearchParams.ts';
import { fetchEvals } from './evalsStore.ts';
import { refetchHistory } from './historyStore.ts';

const createRunResponseSchema = z.object({
  manifest: runManifestSchema,
  summary: runSummarySchema,
  cases: z.array(caseRowSchema),
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
type RunSelection = { runId: string };

type RunState = {
  currentRun: RunDetail | null;
  selectedCaseRunId: string | null;
  selectedCaseId: string | null;
  selectedCaseDetail: CaseDetail | null;
  selectedRunId: string | null;
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
  return { runId };
}

function setCaseSelectionState(selection: CaseSelection | null): void {
  runStore.setPartialState({
    selectedCaseRunId: selection?.runId ?? null,
    selectedCaseId: selection?.caseId ?? null,
    selectedCaseDetail: null,
  });
}

function setCaseSelection(selection: CaseSelection | null): void {
  setCaseSelectionState(selection);
  updateSearchParams((searchParams) => {
    searchParams.delete('caseRun');
    searchParams.delete('case');
    searchParams.delete('run');
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
    selectedRunDetail: null,
  });
}

function setRunSelection(selection: RunSelection | null): void {
  setRunSelectionState(selection);
  updateSearchParams((searchParams) => {
    searchParams.delete('run');
    searchParams.delete('caseRun');
    searchParams.delete('case');
    searchParams.delete('caseTab');
    if (!selection) return;
    searchParams.set('run', selection.runId);
  });
}

async function fetchCaseDetail(runId: string, caseId: string): Promise<void> {
  const fetchResult = await resultify(() =>
    fetch(`/api/runs/${runId}/cases/${caseId}`),
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
    selectedRunDetail: null,
    trials: 1,
    eventSource: null,
  },
});

export type RunTarget =
  | { mode: 'all' }
  | { mode: 'evalIds'; evalIds: string[] };

/** Optional run-start options, notably the cache mode. */
export type StartRunOptions = { cacheMode?: CacheMode };

export async function startRun(
  target: RunTarget,
  options: StartRunOptions = {},
): Promise<void> {
  const { trials } = runStore.state;
  const cacheMode = options.cacheMode ?? 'use';

  const fetchResult = await resultify(() =>
    fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, trials, cache: { mode: cacheMode } }),
    }),
  );
  if (fetchResult.error) return;

  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return;

  const parseResult = resultify(() =>
    createRunResponseSchema.parse(jsonResult.value),
  );
  if (parseResult.error) return;

  runStore.setPartialState({ currentRun: parseResult.value });
  setCaseSelection(null);

  subscribeToRunEvents(parseResult.value.manifest.id);
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
        c.caseId === envelope.payload.caseId &&
        c.trial === envelope.payload.trial
          ? envelope.payload
          : c,
      );
      const hasCase = cases.some(
        (c) =>
          c.caseId === envelope.payload.caseId &&
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
          manifest: { ...prev.currentRun.manifest, status: 'cancelled' },
        },
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
        },
        eventSource: null,
      };
    });
    es.close();
    void refetchHistory();
    void fetchEvals();
  });
}

export async function cancelRun(): Promise<void> {
  const run = runStore.state.currentRun;
  if (!run) return;
  await resultify(() =>
    fetch(`/api/runs/${run.manifest.id}/cancel`, { method: 'POST' }),
  );
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
    runStore.setPartialState({ selectedRunId: null, selectedRunDetail: null });
  }

  if (sameSelection && runStore.state.selectedCaseDetail) return;
  await fetchCaseDetail(selection.runId, selection.caseId);
}

export function closeCase(): void {
  setCaseSelection(null);
}

export async function selectRun(runId: string): Promise<void> {
  setRunSelection({ runId });
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
      runStore.state.selectedRunDetail === null;
    if (runIsAlreadyClosed) return;
    setRunSelectionState(null);
    return;
  }

  const selection = readRunSelectionFromSearchParams(searchParams);
  if (!selection) {
    const runIsAlreadyClosed =
      runStore.state.selectedRunId === null &&
      runStore.state.selectedRunDetail === null;
    if (runIsAlreadyClosed) return;
    setRunSelectionState(null);
    return;
  }

  const sameSelection = runStore.state.selectedRunId === selection.runId;
  if (!sameSelection) {
    setRunSelectionState(selection);
    setCaseSelectionState(null);
  }

  if (sameSelection && runStore.state.selectedRunDetail) return;
  await fetchRunDetail(selection.runId);
}

export function setTrials(trials: number): void {
  runStore.setPartialState({ trials });
}

/**
 * Delete cache entries scoped to a single eval id.
 *
 * Namespace convention is `${evalId}__${spanName}`, so we fetch the list and
 * delete every namespace matching the prefix.
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
