import { Store } from 't-state';
import { evalSummarySchema, type EvalSummary } from '@agent-evals/shared';
import { resultify } from 't-result';
import { z } from 'zod/v4';

const evalSummariesSchema = z.array(evalSummarySchema);

type EvalsState = {
  evals: EvalSummary[];
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
};

export const evalsStore = new Store<EvalsState>({
  state: { evals: [], loading: false, hasLoaded: false, error: null },
});

async function loadEvals(url: string, init?: RequestInit): Promise<void> {
  evalsStore.setPartialState({ loading: true, error: null });
  const fetchResult = await resultify(() => fetch(url, init));
  if (fetchResult.error) {
    evalsStore.setPartialState({
      loading: false,
      hasLoaded: true,
      error:
        'Could not reach the eval server at /api/evals. Start the backend on port 4100 and reload the page.',
    });
    return;
  }
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) {
    evalsStore.setPartialState({
      loading: false,
      hasLoaded: true,
      error: 'The eval server returned an unreadable response.',
    });
    return;
  }
  const parseResult = resultify(() => evalSummariesSchema.parse(jsonResult.value));
  if (parseResult.error) {
    evalsStore.setPartialState({
      loading: false,
      hasLoaded: true,
      error: 'The eval server returned data in an unexpected shape.',
    });
    return;
  }
  evalsStore.setPartialState({
    evals: parseResult.value,
    loading: false,
    hasLoaded: true,
    error: null,
  });
}

export async function fetchEvals(): Promise<void> {
  await loadEvals('/api/evals');
}
