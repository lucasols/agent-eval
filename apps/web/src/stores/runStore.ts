import { Store } from 't-state';
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
import { z } from 'zod/v4';
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

type RunState = {
  currentRun: RunDetail | null;
  selectedCaseId: string | null;
  selectedCaseDetail: CaseDetail | null;
  selectedRunId: string | null;
  selectedRunDetail: RunDetail | null;
  trials: number;
  eventSource: EventSource | null;
};

export const runStore = new Store<RunState>({
  state: {
    currentRun: null,
    selectedCaseId: null,
    selectedCaseDetail: null,
    selectedRunId: null,
    selectedRunDetail: null,
    trials: 1,
    eventSource: null,
  },
});

export type RunTarget =
  | { mode: 'all' }
  | { mode: 'evalIds'; evalIds: string[] };

/** Optional run-start options, notably the cache mode. */
export type StartRunOptions = {
  cacheMode?: CacheMode;
};

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

  runStore.setPartialState({
    currentRun: parseResult.value,
    selectedCaseId: null,
    selectedCaseDetail: null,
  });

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
        (
          c.caseId === envelope.payload.caseId
          && c.trial === envelope.payload.trial
        ) ?
          envelope.payload
        : c,
      );
      const hasCase = cases.some(
        (c) =>
          c.caseId === envelope.payload.caseId
          && c.trial === envelope.payload.trial,
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
  runStore.setPartialState({
    selectedCaseId: caseId,
    selectedCaseDetail: null,
    selectedRunId: null,
    selectedRunDetail: null,
  });

  const fetchResult = await resultify(() =>
    fetch(`/api/runs/${runId}/cases/${caseId}`),
  );
  if (fetchResult.error) return;
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return;
  const parseResult = resultify(() => caseDetailSchema.parse(jsonResult.value));
  if (parseResult.error) return;

  runStore.setPartialState({ selectedCaseDetail: parseResult.value });
}

export function closeCase(): void {
  runStore.setPartialState({ selectedCaseId: null, selectedCaseDetail: null });
}

export async function selectRun(runId: string): Promise<void> {
  runStore.setPartialState({
    selectedRunId: runId,
    selectedRunDetail: null,
    selectedCaseId: null,
    selectedCaseDetail: null,
  });

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

export function closeRun(): void {
  runStore.setPartialState({ selectedRunId: null, selectedRunDetail: null });
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
