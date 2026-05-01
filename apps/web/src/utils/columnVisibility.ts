import type { CaseRow, CellValue, ColumnDef } from '@agent-evals/shared';

type RunRowsWithCases = Array<{ cases: CaseRow[] }>;

export type VisibleRunTableColumns = {
  scoreColumns: ColumnDef[];
  otherCustomColumns: ColumnDef[];
};

export function hasUiValue(value: CellValue | undefined): boolean {
  return value !== undefined && value !== null && value !== '';
}

function hasColumnValueInRuns(runs: RunRowsWithCases, key: string): boolean {
  return runs.some((run) =>
    run.cases.some((row) => hasUiValue(row.columns[key])),
  );
}

function hasColumnKeyInRuns(runs: RunRowsWithCases, key: string): boolean {
  return runs.some((run) =>
    run.cases.some((row) => row.columns[key] !== undefined),
  );
}

function shouldShowColumn(params: {
  column: ColumnDef;
  runs: RunRowsWithCases;
}): boolean {
  const { column, runs } = params;
  if (column.hideInTable === true) return false;
  if (column.hideIfNoValue === true) {
    return hasColumnValueInRuns(runs, column.key);
  }
  if (column.isScore === true) return true;
  return hasColumnKeyInRuns(runs, column.key);
}

export function getVisibleRunTableColumns(params: {
  columnDefs: ColumnDef[];
  runs: RunRowsWithCases;
}): VisibleRunTableColumns {
  const visibleColumns = params.columnDefs.filter((column) =>
    shouldShowColumn({ column, runs: params.runs }),
  );
  return {
    scoreColumns: visibleColumns.filter((column) => column.isScore === true),
    otherCustomColumns: visibleColumns.filter(
      (column) => column.isScore !== true,
    ),
  };
}
