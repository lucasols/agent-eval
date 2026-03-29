import { Store } from 't-state';
import type { EvalSummary } from '@agent-evals/shared';

type EvalsState = {
  evals: EvalSummary[];
  loading: boolean;
  selectedEvalIds: Set<string>;
};

export const evalsStore = new Store<EvalsState>({
  state: {
    evals: [],
    loading: false,
    selectedEvalIds: new Set(),
  },
});

export async function fetchEvals(): Promise<void> {
  evalsStore.setPartialState({ loading: true });
  try {
    const response = await fetch('/api/evals');
    const data = await response.json() as EvalSummary[];
    evalsStore.setPartialState({ evals: data, loading: false });
  } catch {
    evalsStore.setPartialState({ loading: false });
  }
}

export async function refreshDiscovery(): Promise<void> {
  evalsStore.setPartialState({ loading: true });
  try {
    const response = await fetch('/api/evals/refresh', { method: 'POST' });
    const data = await response.json() as EvalSummary[];
    evalsStore.setPartialState({ evals: data, loading: false });
  } catch {
    evalsStore.setPartialState({ loading: false });
  }
}

export function toggleEvalSelection(evalId: string): void {
  evalsStore.setState((prev) => {
    const next = new Set(prev.selectedEvalIds);
    if (next.has(evalId)) {
      next.delete(evalId);
    } else {
      next.add(evalId);
    }
    return { ...prev, selectedEvalIds: next };
  });
}

export function selectAllEvals(): void {
  evalsStore.setState((prev) => ({
    ...prev,
    selectedEvalIds: new Set(prev.evals.map((e) => e.id)),
  }));
}

export function clearEvalSelection(): void {
  evalsStore.setPartialState({ selectedEvalIds: new Set() });
}
