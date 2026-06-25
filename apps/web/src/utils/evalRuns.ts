import {
  deriveScopedSummaryFromCases,
  type CaseRow,
  type CellValue,
  type ColumnDef,
  type EvalSummary,
  type RunManifest,
  type ScopedCaseSummary,
} from '@agent-evals/shared';
import { convertToSentenceCase } from '@ls-stack/utils/stringUtils';

export type ScopedRunDisplayStatus = ScopedCaseSummary['status'] | 'unscored';
export type DisplayScopedCaseSummary = Omit<ScopedCaseSummary, 'status'> & {
  status: ScopedRunDisplayStatus;
};

export type ScopedRunRow = {
  manifest: RunManifest;
  summary: DisplayScopedCaseSummary;
  cases: CaseRow[];
};

export type RunWithCases = { manifest: RunManifest; cases: CaseRow[] };

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
  runs: RunWithCases[],
  evalKey: string,
  columnDefs: ColumnDef[] = [],
): ScopedRunRow[] {
  return runs.map((run) => {
    const cases = run.cases.filter((caseRow) => caseRow.evalKey === evalKey);
    const baseSummary = deriveScopedSummaryFromCases({
      caseRows: cases,
      lifecycleStatus: run.manifest.status,
    });
    return {
      manifest: run.manifest,
      summary: deriveManualScoreAwareSummary({
        summary: baseSummary,
        cases,
        getColumnDefsForCase: (caseRow) =>
          getManualScoreAwareColumnDefs({
            columnDefs,
            columns: caseRow.columns,
          }),
      }),
      cases,
    };
  });
}

export function getManualScoreColumns(
  columnDefs: readonly ColumnDef[],
): ColumnDef[] {
  return columnDefs.filter((column) => column.isManualScore === true);
}

function isMissingManualScoreCandidate(value: CellValue | undefined): boolean {
  return value === null;
}

function toFallbackManualScoreColumnDef(column: ColumnDef): ColumnDef {
  return { ...column, kind: 'number', isScore: true, isManualScore: true };
}

function createFallbackManualScoreColumnDef(key: string): ColumnDef {
  return {
    key,
    label: convertToSentenceCase(key),
    kind: 'number',
    isScore: true,
    isManualScore: true,
  };
}

export function getManualScoreAwareColumnDefs(params: {
  columnDefs: readonly ColumnDef[];
  columns: Record<string, CellValue>;
}): ColumnDef[] {
  if (getManualScoreColumns(params.columnDefs).length > 0) {
    return [...params.columnDefs];
  }

  const missingKeys = new Set(
    Object.entries(params.columns)
      .filter(([, value]) => isMissingManualScoreCandidate(value))
      .map(([key]) => key),
  );
  if (missingKeys.size === 0) return [...params.columnDefs];

  const seenKeys = new Set<string>();
  const nextColumnDefs = params.columnDefs.map((column) => {
    seenKeys.add(column.key);
    if (!missingKeys.has(column.key)) return column;
    return toFallbackManualScoreColumnDef(column);
  });

  for (const key of missingKeys) {
    if (seenKeys.has(key)) continue;
    nextColumnDefs.push(createFallbackManualScoreColumnDef(key));
  }

  return nextColumnDefs;
}

export function getManualScoreAwareColumnDefsForRuns(params: {
  columnDefs: readonly ColumnDef[];
  runs: Array<{ cases: CaseRow[] }>;
}): ColumnDef[] {
  let columnDefs = [...params.columnDefs];
  for (const run of params.runs) {
    for (const caseRow of run.cases) {
      columnDefs = getManualScoreAwareColumnDefs({
        columnDefs,
        columns: caseRow.columns,
      });
    }
  }
  return columnDefs;
}

function hasPendingManualScore(
  caseRow: Pick<CaseRow, 'columns'>,
  columnDefs: readonly ColumnDef[],
): boolean {
  return getManualScoreColumns(columnDefs).some((column) => {
    const value = caseRow.columns[column.key];
    return typeof value !== 'number' || !Number.isFinite(value);
  });
}

function isUnscoredPassCase(
  caseRow: Pick<CaseRow, 'status' | 'columns'>,
  columnDefs: readonly ColumnDef[],
): boolean {
  return (
    caseRow.status === 'pass' && hasPendingManualScore(caseRow, columnDefs)
  );
}

export function getManualScoreAwareCaseDisplayStatus(params: {
  caseRow: Pick<CaseRow, 'status' | 'columns'>;
  columnDefs: readonly ColumnDef[];
}): CaseRow['status'] | 'enqueued' | 'unscored' {
  if (params.caseRow.status === 'pending') return 'enqueued';
  if (isUnscoredPassCase(params.caseRow, params.columnDefs)) return 'unscored';
  return params.caseRow.status;
}

export function deriveManualScoreAwareSummary(params: {
  summary: ScopedCaseSummary;
  cases: readonly CaseRow[];
  getColumnDefsForCase: (caseRow: CaseRow) => readonly ColumnDef[];
}): DisplayScopedCaseSummary {
  let unscoredPassCases = 0;
  for (const caseRow of params.cases) {
    if (isUnscoredPassCase(caseRow, params.getColumnDefsForCase(caseRow))) {
      unscoredPassCases += 1;
    }
  }

  if (unscoredPassCases === 0) return params.summary;

  return {
    ...params.summary,
    status:
      params.summary.status === 'pass' ? 'unscored' : params.summary.status,
    passedCases: params.summary.passedCases - unscoredPassCases,
    pendingCases: params.summary.pendingCases + unscoredPassCases,
  };
}

export function getCaseColumnDefsFromEvalSummaries(params: {
  caseRow: CaseRow;
  evals: Array<Pick<EvalSummary, 'key' | 'columnDefs'>>;
}): readonly ColumnDef[] {
  const evalKey = params.caseRow.evalKey;
  if (evalKey === undefined) return [];
  return params.evals.find((ev) => ev.key === evalKey)?.columnDefs ?? [];
}

export function runTargetsEval(
  manifest: RunManifest,
  evalKey: string,
): boolean {
  if (manifest.target.mode === 'all') {
    return manifest.evalSourceFingerprints[evalKey] !== undefined;
  }
  if (manifest.target.mode === 'evalIds') {
    return manifest.target.evalKeys?.includes(evalKey) ?? false;
  }
  return manifest.target.evalKeys?.includes(evalKey) ?? false;
}

export function getRunsForEval<T extends RunWithCases>(
  runs: T[],
  evalKey: string,
): T[] {
  return runs.filter(
    (run) =>
      runTargetsEval(run.manifest, evalKey) ||
      run.cases.some((caseRow) => caseRow.evalKey === evalKey),
  );
}

export function getEvalIdsForFolderPath(params: {
  evals: Array<Pick<EvalSummary, 'key' | 'filePath'>>;
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
      .map((ev) => ev.key),
  );
}

export function scopeRunCases(params: {
  cases: CaseRow[];
  evals: Array<Pick<EvalSummary, 'id' | 'key' | 'filePath'>>;
  selectedEvalKey: string | null;
  selectedFolderPath: string | null;
}): RunCaseScope {
  const { cases, evals, selectedEvalKey, selectedFolderPath } = params;

  if (selectedEvalKey) {
    const selectedEvalLabel =
      evals.find((ev) => ev.key === selectedEvalKey)?.id ?? selectedEvalKey;
    return {
      cases: cases.filter((caseRow) => caseRow.evalKey === selectedEvalKey),
      label: selectedEvalLabel,
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
    cases: cases.filter(
      (caseRow) =>
        caseRow.evalKey !== undefined && evalIdsInFolder.has(caseRow.evalKey),
    ),
    label: selectedFolderPath,
  };
}
