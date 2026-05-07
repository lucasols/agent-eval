import {
  discoveryIssueSchema,
  evalSummarySchema,
  type DiscoveryIssue,
  type EvalSummary,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { Store } from 't-state';
import { z } from 'zod/v4';
import { apiUrl } from '#src/utils/apiUrl';

const evalSummariesSchema = z.array(evalSummarySchema);
const discoveryIssuesSchema = z.array(discoveryIssueSchema);

type EvalsState = {
  evals: EvalSummary[];
  discoveryIssues: DiscoveryIssue[];
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
};

export const evalsStore = new Store<EvalsState>({
  state: {
    evals: [],
    discoveryIssues: [],
    loading: false,
    hasLoaded: false,
    error: null,
  },
});

async function loadEvals(url: string, init?: RequestInit): Promise<void> {
  evalsStore.setPartialState({ loading: true, error: null });
  const fetchResult = await resultify(() => fetch(url, init));
  if (fetchResult.error) {
    evalsStore.setPartialState({
      loading: false,
      hasLoaded: true,
      error:
        'Could not reach the eval server at /api/evals. Start the backend and reload the page.',
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
  const parseResult = resultify(() =>
    evalSummariesSchema.parse(jsonResult.value),
  );
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
    discoveryIssues: await fetchDiscoveryIssues(),
    loading: false,
    hasLoaded: true,
    error: null,
  });
}

async function fetchDiscoveryIssues(): Promise<DiscoveryIssue[]> {
  const fetchResult = await resultify(() =>
    fetch(apiUrl('/api/evals/discovery-issues')),
  );
  if (fetchResult.error) return [];
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return [];
  const parseResult = discoveryIssuesSchema.safeParse(jsonResult.value);
  return parseResult.success ? parseResult.data : [];
}

export async function fetchEvals(): Promise<void> {
  await loadEvals(apiUrl('/api/evals'));
}

/** Ask the server to open the eval's source file in the user's editor. */
export async function openEvalInEditor(evalId: string): Promise<void> {
  await resultify(() =>
    fetch(apiUrl(`/api/evals/${encodeURIComponent(evalId)}/open-in-editor`), {
      method: 'POST',
    }),
  );
}
