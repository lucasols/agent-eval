import type { CaseRow, CellValue, ColumnDef } from '@agent-evals/shared';
import { convertToSentenceCase } from '@ls-stack/utils/stringUtils';

type RunRowsWithCases = Array<{ cases: CaseRow[] }>;

function inferRuntimeColumnKind(value: CellValue): ColumnDef['kind'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function createRuntimeColumnDef(key: string, value: CellValue): ColumnDef {
  return {
    key,
    label: convertToSentenceCase(key),
    kind: inferRuntimeColumnKind(value),
  };
}

export function getDisplayColumnLabel(def: ColumnDef): string {
  return def.label === def.key ? convertToSentenceCase(def.key) : def.label;
}

export function mergeRuntimeColumnDefs(
  columnDefs: ColumnDef[],
  columns: Record<string, CellValue>,
  outputColumnDefs: ColumnDef[] = [],
): ColumnDef[] {
  const configuredKeys = new Set(columnDefs.map((columnDef) => columnDef.key));
  const explicitRuntimeDefs = outputColumnDefs.filter(
    (columnDef) =>
      columns[columnDef.key] !== undefined &&
      !configuredKeys.has(columnDef.key),
  );
  for (const columnDef of explicitRuntimeDefs) {
    configuredKeys.add(columnDef.key);
  }
  const runtimeColumnDefs = Object.entries(columns)
    .filter(([key]) => !configuredKeys.has(key))
    .map(([key, value]) => createRuntimeColumnDef(key, value));

  return [...columnDefs, ...explicitRuntimeDefs, ...runtimeColumnDefs];
}

export function mergeRunRuntimeColumnDefs(
  columnDefs: ColumnDef[],
  runs: RunRowsWithCases,
): ColumnDef[] {
  let merged = columnDefs;
  for (const run of runs) {
    for (const row of run.cases) {
      merged = mergeRuntimeColumnDefs(
        merged,
        row.columns,
        row.outputColumnDefs,
      );
    }
  }
  return merged;
}
