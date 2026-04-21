import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveScopedSummaryFromCases } from '@agent-evals/shared';
import type {
  CaseDetail,
  CaseRow,
  RunManifest,
  RunSummary,
} from '@agent-evals/shared';

export async function persistRunState(runState: {
  runDir: string;
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
}): Promise<void> {
  await writeFile(
    join(runState.runDir, 'summary.json'),
    JSON.stringify(runState.summary, null, 2),
  );
  await writeFile(
    join(runState.runDir, 'run.json'),
    JSON.stringify(runState.manifest, null, 2),
  );
  const casesJsonl = runState.cases.map((c) => JSON.stringify(c)).join('\n');
  await writeFile(join(runState.runDir, 'cases.jsonl'), casesJsonl);
}

export function recomputePersistedCaseStatus(
  caseRow: CaseRow,
  caseDetail: CaseDetail | undefined,
  scoreThresholds: ReadonlyMap<string, number>,
): CaseRow['status'] {
  if (caseRow.status === 'cancelled') return 'cancelled';
  if (caseDetail?.error !== null && caseDetail?.error !== undefined)
    return 'error';
  if ((caseDetail?.assertionFailures.length ?? 0) > 0) return 'fail';

  let sawScore = false;
  for (const [key, passThreshold] of scoreThresholds) {
    const rawValue = caseRow.columns[key] ?? caseDetail?.columns[key];
    if (typeof rawValue !== 'number') continue;
    sawScore = true;
    if (rawValue < passThreshold) return 'fail';
  }

  if (sawScore) return 'pass';
  return caseRow.status === 'error' ? 'error' : 'pass';
}

export function runTouchesEval(params: {
  target: RunManifest['target'];
  caseRows: CaseRow[];
  evalId: string;
  evalExists: boolean;
}): boolean {
  if (params.caseRows.some((caseRow) => caseRow.evalId === params.evalId)) {
    return true;
  }
  if (params.target.mode === 'all') return params.evalExists;
  if (params.target.mode === 'evalIds') {
    return params.target.evalIds?.includes(params.evalId) ?? false;
  }
  return false;
}

export type MaintainedRunState = {
  runDir: string;
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
  caseDetails: Map<string, CaseDetail>;
};

export async function recomputeEvalStatusesInRuns(params: {
  runs: Iterable<MaintainedRunState>;
  evalId: string;
  evalExists: boolean;
  scoreThresholds: ReadonlyMap<string, number>;
  persistCaseDetail: (runDir: string, caseDetail: CaseDetail) => Promise<void>;
}): Promise<number> {
  let updatedRuns = 0;
  for (const run of params.runs) {
    if (
      !runTouchesEval({
        target: run.manifest.target,
        caseRows: run.cases,
        evalId: params.evalId,
        evalExists: params.evalExists,
      })
    ) {
      continue;
    }
    if (run.manifest.status === 'running') continue;

    let changed = false;
    for (const caseRow of run.cases) {
      if (caseRow.evalId !== params.evalId) continue;
      const caseDetail = run.caseDetails.get(caseRow.caseId);
      const nextStatus = recomputePersistedCaseStatus(
        caseRow,
        caseDetail,
        params.scoreThresholds,
      );
      if (caseRow.status === nextStatus) continue;

      caseRow.status = nextStatus;
      if (caseDetail) {
        caseDetail.status = nextStatus;
        await params.persistCaseDetail(run.runDir, caseDetail);
      }
      changed = true;
    }

    if (!changed) continue;

    const derivedSummary = deriveScopedSummaryFromCases({
      caseRows: run.cases,
    });
    run.summary.totalCases = derivedSummary.totalCases;
    run.summary.passedCases = derivedSummary.passedCases;
    run.summary.failedCases = derivedSummary.failedCases;
    run.summary.errorCases = derivedSummary.errorCases;
    run.summary.cancelledCases = derivedSummary.cancelledCases;
    run.summary.averageScore = derivedSummary.averageScore;
    run.summary.cost = derivedSummary.cost;

    await persistRunState(run);
    updatedRuns += 1;
  }
  return updatedRuns;
}
