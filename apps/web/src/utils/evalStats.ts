import type {
  CaseRow,
  ColumnDef,
  EvalStatAggregate,
  EvalStatItem,
  EvalSummary,
  ScopedCaseSummary,
} from '@agent-evals/shared';
import { formatDuration, formatNumericCellValue } from '#src/utils/formatters';

const EM_DASH = '\u2014';

export type EvalStatContext = {
  evalSummary: Pick<EvalSummary, 'caseCount' | 'columnDefs'>;
  latestSummary: ScopedCaseSummary | null;
  latestCases: CaseRow[];
};

export type EvalStatDisplay = {
  label: string;
  aggregateLabel: string | undefined;
  value: string;
  hasValue: boolean;
  accent: boolean;
};

export function computeStatDisplay(
  stat: EvalStatItem,
  ctx: EvalStatContext,
): EvalStatDisplay {
  if (stat.kind === 'cases') {
    return {
      label: 'Cases',
      aggregateLabel: undefined,
      value:
        ctx.evalSummary.caseCount !== null
          ? String(ctx.evalSummary.caseCount)
          : EM_DASH,
      hasValue: ctx.evalSummary.caseCount !== null,
      accent: false,
    };
  }
  if (stat.kind === 'passRate') {
    const s = ctx.latestSummary;
    return {
      label: 'Pass rate',
      aggregateLabel: undefined,
      value:
        s && s.totalCases > 0
          ? `${String(s.passedCases)}/${String(s.totalCases)}`
          : EM_DASH,
      hasValue: s !== null && s.totalCases > 0,
      accent: stat.accent ?? false,
    };
  }
  if (stat.kind === 'duration') {
    return {
      label: 'Duration',
      aggregateLabel: undefined,
      value: formatDuration(ctx.latestSummary?.totalDurationMs ?? null),
      hasValue: ctx.latestSummary !== null,
      accent: false,
    };
  }
  if (stat.kind === 'cacheHits') {
    const s = ctx.latestSummary;
    return {
      label: 'Cache hits',
      aggregateLabel: undefined,
      value:
        s !== null && s.cacheOperations > 0
          ? `${String(s.cacheHits)}/${String(s.cacheOperations)}`
          : EM_DASH,
      hasValue: s !== null && s.cacheOperations > 0,
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
  const aggregateLabel = formatAggregateLabel(stat.aggregate);
  if (aggregated === null) {
    return {
      label,
      aggregateLabel,
      value: EM_DASH,
      hasValue: false,
      accent: stat.accent ?? false,
    };
  }
  const effectiveDef = buildEffectiveColumnDef(columnDef, stat);
  return {
    label,
    aggregateLabel,
    value: formatNumericCellValue(effectiveDef, aggregated),
    hasValue: true,
    accent: stat.accent ?? false,
  };
}

function formatAggregateLabel(aggregate: EvalStatAggregate): string {
  if (aggregate === 'avg') return 'avg';
  if (aggregate === 'sum') return 'sum';
  if (aggregate === 'min') return 'min';
  if (aggregate === 'max') return 'max';
  return 'last';
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
      format:
        stat.format ?? (stat.numberFormat === undefined ? undefined : 'number'),
      numberFormat: stat.numberFormat,
      isScore: false,
    };
  }
  if (stat.format === undefined && stat.numberFormat === undefined) {
    return columnDef;
  }
  return {
    ...columnDef,
    format:
      stat.format ??
      (stat.numberFormat === undefined ? columnDef.format : 'number'),
    numberFormat: stat.numberFormat ?? columnDef.numberFormat,
  };
}
