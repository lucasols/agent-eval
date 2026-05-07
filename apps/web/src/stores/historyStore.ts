import {
  caseRowSchema,
  runManifestSchema,
  runSummarySchema,
  type CaseRow,
  type RunManifest,
  type RunSummary,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { Store } from 't-state';
import { z } from 'zod/v4';
import { apiUrl } from '#src/utils/apiUrl';

export type HistoricalRun = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
};

const runDetailSchema = z.object({
  manifest: runManifestSchema,
  summary: runSummarySchema,
  cases: z.array(caseRowSchema),
});
const runHistorySchema = z.array(runDetailSchema);

type HistoryState = { runs: HistoricalRun[]; loading: boolean };

export const historyStore = new Store<HistoryState>({
  state: { runs: [], loading: false },
});

let historyFetchInFlight: Promise<void> | null = null;

async function fetchRunHistory(): Promise<HistoricalRun[] | null> {
  const fetchResult = await resultify(() => fetch(apiUrl('/api/runs/history')));
  if (fetchResult.error) return null;
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return null;
  const parseResult = resultify(() => runHistorySchema.parse(jsonResult.value));
  if (parseResult.error) return null;
  return parseResult.value;
}

export async function refetchHistory(): Promise<void> {
  if (historyFetchInFlight) {
    await historyFetchInFlight;
    return;
  }
  historyFetchInFlight = refetchHistoryInner();
  await historyFetchInFlight.finally(() => {
    historyFetchInFlight = null;
  });
}

async function refetchHistoryInner(): Promise<void> {
  historyStore.setPartialState({ loading: true });
  const runs = await fetchRunHistory();
  if (!runs) {
    historyStore.setPartialState({ loading: false });
    return;
  }

  runs.sort(
    (a, b) =>
      new Date(b.manifest.startedAt).getTime() -
      new Date(a.manifest.startedAt).getTime(),
  );
  historyStore.setPartialState({ runs, loading: false });
}

export function runTargetsEval(
  manifest: RunManifest,
  evalKey: string,
): boolean {
  if (manifest.target.mode === 'all') return true;
  if (manifest.target.mode === 'evalIds') {
    return manifest.target.evalKeys?.includes(evalKey) ?? false;
  }
  return manifest.target.evalKeys?.includes(evalKey) ?? false;
}

export function getRunsForEval(
  runs: HistoricalRun[],
  evalKey: string,
): HistoricalRun[] {
  return runs.filter(
    (r) =>
      runTargetsEval(r.manifest, evalKey) ||
      r.cases.some((caseRow) => caseRow.evalKey === evalKey),
  );
}
