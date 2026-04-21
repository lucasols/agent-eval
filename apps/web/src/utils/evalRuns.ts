import {
  deriveScopedSummaryFromCases,
  type CaseRow,
  type RunManifest,
  type ScopedCaseSummary,
} from '@agent-evals/shared';

export type ScopedRunRow = {
  manifest: RunManifest;
  summary: ScopedCaseSummary;
  cases: CaseRow[];
};

export function buildEvalScopedRunRows(
  runs: Array<{ manifest: RunManifest; cases: CaseRow[] }>,
  evalId: string,
): ScopedRunRow[] {
  return runs.map((run) => {
    const cases = run.cases.filter((caseRow) => caseRow.evalId === evalId);
    return {
      manifest: run.manifest,
      summary: deriveScopedSummaryFromCases({
        caseRows: cases,
        lifecycleStatus: run.manifest.status,
      }),
      cases,
    };
  });
}
