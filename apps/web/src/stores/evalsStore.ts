import { Store } from 't-state';
import { evalSummarySchema, type EvalSummary } from '@agent-evals/shared';
import { resultify } from 't-result';
import { z } from 'zod/v4';

const evalSummariesSchema = z.array(evalSummarySchema);

type EvalsState = {
  evals: EvalSummary[];
  loading: boolean;
};

export const evalsStore = new Store<EvalsState>({
  state: { evals: [], loading: false },
});

async function loadEvals(url: string, init?: RequestInit): Promise<void> {
  evalsStore.setPartialState({ loading: true });
  const fetchResult = await resultify(() => fetch(url, init));
  if (fetchResult.error) {
    evalsStore.setPartialState({ loading: false });
    return;
  }
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) {
    evalsStore.setPartialState({ loading: false });
    return;
  }
  const parseResult = resultify(() => evalSummariesSchema.parse(jsonResult.value));
  if (parseResult.error) {
    evalsStore.setPartialState({ loading: false });
    return;
  }
  evalsStore.setPartialState({ evals: parseResult.value, loading: false });
}

export async function fetchEvals(): Promise<void> {
  await loadEvals('/api/evals');
}

export async function refreshDiscovery(): Promise<void> {
  await loadEvals('/api/evals/refresh', { method: 'POST' });
}
