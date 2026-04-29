import {
  deriveScopedSummaryFromCases,
  type CaseRow,
  type EvalSummary,
  type RunManifest,
  type ScopedCaseSummary,
} from '@agent-evals/shared';

export type ScopedRunRow = {
  manifest: RunManifest;
  summary: ScopedCaseSummary;
  cases: CaseRow[];
};

export type RunCaseScope = { cases: CaseRow[]; label: string | null };

function getDirSegments(filePath: string): string[] {
  const parts = filePath.split('/').filter((part) => part.length > 0);
  return parts.slice(0, -1);
}

function getCommonPrefixLength(allDirs: string[][]): number {
  const [first, ...rest] = allDirs;
  if (!first) return 0;

  let prefixLength = first.length;
  for (const dir of rest) {
    let index = 0;
    while (
      index < prefixLength &&
      index < dir.length &&
      dir[index] === first[index]
    ) {
      index += 1;
    }
    prefixLength = index;
  }

  return prefixLength;
}

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

export function getEvalIdsForFolderPath(params: {
  evals: Array<Pick<EvalSummary, 'id' | 'filePath'>>;
  selectedFolderPath: string;
}): Set<string> {
  const prefixLength = getCommonPrefixLength(
    params.evals.map((ev) => getDirSegments(ev.filePath)),
  );

  return new Set(
    params.evals
      .filter((ev) => {
        const dir = getDirSegments(ev.filePath).slice(prefixLength).join('/');
        return (
          dir === params.selectedFolderPath ||
          dir.startsWith(`${params.selectedFolderPath}/`)
        );
      })
      .map((ev) => ev.id),
  );
}

export function scopeRunCases(params: {
  cases: CaseRow[];
  evals: Array<Pick<EvalSummary, 'id' | 'filePath'>>;
  selectedEvalId: string | null;
  selectedFolderPath: string | null;
}): RunCaseScope {
  const { cases, evals, selectedEvalId, selectedFolderPath } = params;

  if (selectedEvalId) {
    return {
      cases: cases.filter((caseRow) => caseRow.evalId === selectedEvalId),
      label: selectedEvalId,
    };
  }

  if (!selectedFolderPath) {
    return { cases, label: null };
  }

  const evalIdsInFolder = getEvalIdsForFolderPath({
    evals,
    selectedFolderPath,
  });

  return {
    cases: cases.filter((caseRow) => evalIdsInFolder.has(caseRow.evalId)),
    label: selectedFolderPath,
  };
}
