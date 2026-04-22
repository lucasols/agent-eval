import type {
  CaseRow,
  ColumnDef,
  EvalStatAggregate,
  EvalStatItem,
  EvalSummary,
  ScopedCaseSummary,
} from '@agent-evals/shared';
import {
  formatCost,
  formatDuration,
  formatNumericCellValue,
} from './formatters.ts';

const EM_DASH = '\u2014';

export type EvalStatContext = {
  evalSummary: Pick<EvalSummary, 'caseCount' | 'columnDefs'>;
  latestSummary: ScopedCaseSummary | null;
  latestCases: CaseRow[];
};

export type EvalStatDisplay = { label: string; value: string; accent: boolean };

export function computeStatDisplay(
  stat: EvalStatItem,
  ctx: EvalStatContext,
): EvalStatDisplay {
  if (stat.kind === 'cases') {
    return {
      label: 'Cases',
      value:
        ctx.evalSummary.caseCount !== null
          ? String(ctx.evalSummary.caseCount)
          : EM_DASH,
      accent: false,
    };
  }
  if (stat.kind === 'passRate') {
    const s = ctx.latestSummary;
    return {
      label: 'Pass rate',
      value:
        s && s.totalCases > 0
          ? `${String(s.passedCases)}/${String(s.totalCases)}`
          : EM_DASH,
      accent: stat.accent ?? false,
    };
  }
  if (stat.kind === 'duration') {
    return {
      label: 'Duration',
      value: formatDuration(ctx.latestSummary?.totalDurationMs ?? null),
      accent: false,
    };
  }
  if (stat.kind === 'cost') {
    return {
      label: 'Cost',
      value: formatCost(ctx.latestSummary?.cost.totalUsd ?? null),
      accent: false,
    };
  }
  return computeColumnStat(stat, ctx);
}

function computeColumnStat(
  stat: Extract<EvalStatItem, { kind: 'column' }>,
  ctx: EvalStatContext,
): EvalStatDisplay {
  const columnDef = ctx.evalSummary.columnDefs.find((c) => c.key === stat.key);
  const label = stat.label ?? columnDef?.label ?? stat.key;
  const values = collectNumericValues(ctx.latestCases, stat.key);
  const aggregated = aggregateColumn(values, stat.aggregate);
  if (aggregated === null) {
    return { label, value: EM_DASH, accent: stat.accent ?? false };
  }
  const effectiveDef = buildEffectiveColumnDef(columnDef, stat);
  return {
    label,
    value: formatNumericCellValue(effectiveDef, aggregated),
    accent: stat.accent ?? false,
  };
}

function collectNumericValues(cases: CaseRow[], key: string): number[] {
  const values: number[] = [];
  for (const row of cases) {
    const value = row.columns[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

function aggregateColumn(
  values: number[],
  mode: EvalStatAggregate,
): number | null {
  if (values.length === 0) return null;
  if (mode === 'avg') {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  if (mode === 'sum') {
    return values.reduce((a, b) => a + b, 0);
  }
  if (mode === 'min') return Math.min(...values);
  if (mode === 'max') return Math.max(...values);
  return values[values.length - 1] ?? null;
}

function buildEffectiveColumnDef(
  columnDef: ColumnDef | undefined,
  stat: Extract<EvalStatItem, { kind: 'column' }>,
): ColumnDef {
  if (columnDef === undefined) {
    return {
      key: stat.key,
      label: stat.label ?? stat.key,
      kind: 'number',
      format: stat.format,
      isScore: false,
    };
  }
  if (stat.format === undefined) return columnDef;
  return { ...columnDef, format: stat.format };
}
