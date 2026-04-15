import { Store } from 't-state';
import {
  caseRowSchema,
  runManifestSchema,
  runSummarySchema,
  type CaseRow,
  type RunManifest,
  type RunSummary,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { z } from 'zod/v4';

export type HistoricalRun = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
};

const runManifestArraySchema = z.array(runManifestSchema);
const runDetailSchema = z.object({
  manifest: runManifestSchema,
  summary: runSummarySchema,
  cases: z.array(caseRowSchema),
});

type HistoryState = {
  runs: HistoricalRun[];
  loading: boolean;
};

export const historyStore = new Store<HistoryState>({
  state: { runs: [], loading: false },
});

async function fetchManifests(): Promise<RunManifest[] | null> {
  const fetchResult = await resultify(() => fetch('/api/runs'));
  if (fetchResult.error) return null;
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return null;
  const parseResult = resultify(() =>
    runManifestArraySchema.parse(jsonResult.value),
  );
  if (parseResult.error) return null;
  return parseResult.value;
}

async function fetchRunDetail(runId: string): Promise<HistoricalRun | null> {
  const fetchResult = await resultify(() => fetch(`/api/runs/${runId}`));
  if (fetchResult.error) return null;
  if (!fetchResult.value.ok) return null;
  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) return null;
  const parseResult = resultify(() => runDetailSchema.parse(jsonResult.value));
  if (parseResult.error) return null;
  return parseResult.value;
}

export async function refetchHistory(): Promise<void> {
  historyStore.setPartialState({ loading: true });
  const manifests = await fetchManifests();
  if (!manifests) {
    historyStore.setPartialState({ loading: false });
    return;
  }

  const details = await Promise.all(
    manifests.map((m) => fetchRunDetail(m.id)),
  );
  const runs: HistoricalRun[] = [];
  for (const d of details) {
    if (d) runs.push(d);
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
  evalId: string,
): boolean {
  if (manifest.target.mode === 'all') return true;
  if (manifest.target.mode === 'evalIds') {
    return manifest.target.evalIds?.includes(evalId) ?? false;
  }
  return false;
}

export function getRunsForEval(
  runs: HistoricalRun[],
  evalId: string,
): HistoricalRun[] {
  return runs.filter((r) => runTargetsEval(r.manifest, evalId));
}
