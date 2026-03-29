import { Store } from 't-state';
import type { CacheMode, CaseRow, RunManifest, RunSummary, CaseDetail } from '@agent-evals/shared';

type RunState = {
  currentRun: {
    manifest: RunManifest;
    summary: RunSummary;
    cases: CaseRow[];
  } | null;
  selectedCaseId: string | null;
  selectedCaseDetail: CaseDetail | null;
  cacheMode: CacheMode;
  trials: number;
  eventSource: EventSource | null;
};

export const runStore = new Store<RunState>({
  state: {
    currentRun: null,
    selectedCaseId: null,
    selectedCaseDetail: null,
    cacheMode: 'local',
    trials: 1,
    eventSource: null,
  },
});

export async function startRun(target: {
  mode: 'all' | 'evalIds';
  evalIds?: string[];
}): Promise<void> {
  const { cacheMode, trials } = runStore.state;

  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, cacheMode, trials }),
  });

  const run = await response.json() as { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] };
  runStore.setPartialState({
    currentRun: run,
    selectedCaseId: null,
    selectedCaseDetail: null,
  });

  subscribeToRunEvents(run.manifest.id);
}

function subscribeToRunEvents(runId: string): void {
  const existing = runStore.state.eventSource;
  if (existing) {
    existing.close();
  }

  const es = new EventSource(`/api/runs/${runId}/events`);
  runStore.setPartialState({ eventSource: es });

  es.addEventListener('run.summary', (e) => {
    const envelope = JSON.parse(e.data) as { payload: RunSummary };
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      return { ...prev, currentRun: { ...prev.currentRun, summary: envelope.payload } };
    });
  });

  es.addEventListener('case.updated', (e) => {
    const envelope = JSON.parse(e.data) as { payload: CaseRow };
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      const cases = prev.currentRun.cases.map((c) =>
        c.caseId === envelope.payload.caseId && c.trial === envelope.payload.trial
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
  });

  es.addEventListener('case.finished', (e) => {
    const envelope = JSON.parse(e.data) as { payload: CaseRow };
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      const cases = prev.currentRun.cases.map((c) =>
        c.caseId === envelope.payload.caseId && c.trial === envelope.payload.trial
          ? envelope.payload
          : c,
      );
      return { ...prev, currentRun: { ...prev.currentRun, cases } };
    });
  });

  es.addEventListener('run.finished', (e) => {
    const envelope = JSON.parse(e.data) as { payload: RunSummary };
    runStore.setState((prev) => {
      if (!prev.currentRun) return prev;
      return {
        ...prev,
        currentRun: {
          ...prev.currentRun,
          summary: envelope.payload,
          manifest: { ...prev.currentRun.manifest, status: 'completed' },
        },
        eventSource: null,
      };
    });
    es.close();
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
  });

  es.addEventListener('run.error', (e) => {
    const envelope = JSON.parse(e.data) as { payload: { message: string } };
    console.error('Run error:', envelope.payload.message);
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
  });
}

export async function cancelRun(): Promise<void> {
  const run = runStore.state.currentRun;
  if (!run) return;
  await fetch(`/api/runs/${run.manifest.id}/cancel`, { method: 'POST' });
}

export async function selectCase(caseId: string): Promise<void> {
  const run = runStore.state.currentRun;
  if (!run) return;

  runStore.setPartialState({ selectedCaseId: caseId });

  try {
    const response = await fetch(
      `/api/runs/${run.manifest.id}/cases/${caseId}`,
    );
    const detail = await response.json() as CaseDetail;
    runStore.setPartialState({ selectedCaseDetail: detail });
  } catch {
    runStore.setPartialState({ selectedCaseDetail: null });
  }
}

export function closeCase(): void {
  runStore.setPartialState({ selectedCaseId: null, selectedCaseDetail: null });
}

export function setCacheMode(mode: CacheMode): void {
  runStore.setPartialState({ cacheMode: mode });
}

export function setTrials(trials: number): void {
  runStore.setPartialState({ trials });
}
