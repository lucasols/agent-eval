import type {
  CaseRow,
  ColumnDef,
  EvalStatAggregate,
  EvalStatItem,
  EvalSummary,
  ScopedCaseSummary,
} from '@agent-evals/shared';
import {
  formatDuration,
  formatNumericCellValue,
  formatPercent,
} from '#src/utils/formatters';

const EM_DASH = '\u2014';

export type EvalStatContext = {
  evalSummary: Pick<EvalSummary, 'caseCount' | 'columnDefs'>;
  latestSummary: ScopedCaseSummary | null;
  latestCases: CaseRow[];
  aggregateModeOverride: EvalStatAggregate | undefined;
  cacheAggregateModeOverride: EvalStatAggregate | undefined;
};

export type EvalStatDisplay = {
  label: string;
  aggregateLabel: string | undefined;
  aggregateMode: EvalStatAggregate | undefined;
  aggregateControl: 'numeric' | 'cache' | undefined;
  aggregateTooltip: string | undefined;
  value: string;
  hasValue: boolean;
  accent: boolean;
};

export const EVAL_STAT_AGGREGATE_MODES = [
  'avg',
  'max',
  'min',
  'sum',
  'best',
  'worst',
] as const satisfies readonly EvalStatAggregate[];

export const CACHE_HIT_AGGREGATE_MODES = [
  'sum',
  'avg',
  'max',
  'min',
  'best',
  'worst',
] as const satisfies readonly EvalStatAggregate[];

export function computeStatDisplay(
  stat: EvalStatItem,
  ctx: EvalStatContext,
): EvalStatDisplay {
  if (stat.kind === 'cases') {
    return {
      label: 'Cases',
      aggregateLabel: undefined,
      aggregateMode: undefined,
      aggregateControl: undefined,
      aggregateTooltip: undefined,
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
      aggregateMode: undefined,
      aggregateControl: undefined,
      aggregateTooltip: undefined,
      value:
        s && s.totalCases > 0
          ? `${String(s.passedCases)}/${String(s.totalCases)}`
          : EM_DASH,
      hasValue: s !== null && s.totalCases > 0,
      accent: stat.accent ?? false,
    };
  }
  if (stat.kind === 'duration') {
    return computeDurationStat(stat, ctx);
  }
  if (stat.kind === 'cacheHits') {
    return computeCacheHitsStat(stat, ctx);
  }
  return computeColumnStat(stat, ctx);
}

function computeDurationStat(
  stat: Extract<EvalStatItem, { kind: 'duration' }>,
  ctx: EvalStatContext,
): EvalStatDisplay {
  const values = collectDurationValues(ctx.latestCases);
  const aggregateMode = ctx.aggregateModeOverride ?? stat.aggregate ?? 'sum';
  const aggregated = aggregateColumn(values, aggregateMode);
  const aggregateLabel = formatAggregateLabel(aggregateMode);
  if (aggregated === null) {
    return {
      label: 'Duration',
      aggregateLabel,
      aggregateMode,
      aggregateControl: 'numeric',
      aggregateTooltip: undefined,
      value: EM_DASH,
      hasValue: false,
      accent: false,
    };
  }
  return {
    label: 'Duration',
    aggregateLabel,
    aggregateMode,
    aggregateControl: 'numeric',
    aggregateTooltip: formatAggregateTooltip(values, {
      key: 'durationMs',
      label: 'Duration',
      kind: 'number',
      format: 'duration',
    }),
    value: formatDuration(aggregated),
    hasValue: true,
    accent: false,
  };
}

function computeCacheHitsStat(
  stat: Extract<EvalStatItem, { kind: 'cacheHits' }>,
  ctx: EvalStatContext,
): EvalStatDisplay {
  const entries = collectCacheHitEntries(ctx.latestCases);
  const aggregateMode =
    ctx.cacheAggregateModeOverride ?? stat.aggregate ?? 'sum';
  const aggregated =
    entries.length > 0 ? aggregateCacheHits(entries, aggregateMode) : null;
  const summaryFallback =
    ctx.latestSummary !== null && ctx.latestSummary.cacheOperations > 0
      ? {
          hits: ctx.latestSummary.cacheHits,
          operations: ctx.latestSummary.cacheOperations,
        }
      : null;
  const value =
    aggregated ?? (aggregateMode === 'sum' ? summaryFallback : null);
  const aggregateLabel = formatAggregateLabel(aggregateMode);
  if (value === null) {
    return {
      label: 'Cache hits',
      aggregateLabel,
      aggregateMode,
      aggregateControl: 'cache',
      aggregateTooltip: undefined,
      value: EM_DASH,
      hasValue: false,
      accent: false,
    };
  }
  return {
    label: 'Cache hits',
    aggregateLabel,
    aggregateMode,
    aggregateControl: 'cache',
    aggregateTooltip:
      entries.length > 0 ? formatCacheAggregateTooltip(entries) : undefined,
    value: formatCacheAggregateValue(value),
    hasValue: true,
    accent: false,
  };
}

function computeColumnStat(
  stat: Extract<EvalStatItem, { kind: 'column' }>,
  ctx: EvalStatContext,
): EvalStatDisplay {
  const columnDef = ctx.evalSummary.columnDefs.find((c) => c.key === stat.key);
  const label = stat.label ?? columnDef?.label ?? stat.key;
  const values = collectNumericValues(ctx.latestCases, stat.key);
  const aggregateMode = ctx.aggregateModeOverride ?? stat.aggregate;
  const aggregated = aggregateColumn(values, aggregateMode);
  const aggregateLabel = formatAggregateLabel(aggregateMode);
  if (aggregated === null) {
    return {
      label,
      aggregateLabel,
      aggregateMode,
      aggregateControl: 'numeric',
      aggregateTooltip: undefined,
      value: EM_DASH,
      hasValue: false,
      accent: stat.accent ?? false,
    };
  }
  const effectiveDef = buildEffectiveColumnDef(columnDef, stat);
  return {
    label,
    aggregateLabel,
    aggregateMode,
    aggregateControl: 'numeric',
    aggregateTooltip: formatAggregateTooltip(values, effectiveDef),
    value: formatNumericCellValue(effectiveDef, aggregated),
    hasValue: true,
    accent: stat.accent ?? false,
  };
}

type CacheHitEntry = { hits: number; operations: number };

function formatCacheAggregateValue(entry: CacheHitEntry): string {
  return `${formatCacheCount(entry.hits)}/${formatCacheCount(entry.operations)}`;
}

function formatCacheCount(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function formatCacheAggregateTooltip(entries: CacheHitEntry[]): string {
  return CACHE_HIT_AGGREGATE_MODES.map((mode) => {
    const value = aggregateCacheHits(entries, mode);
    const rendered =
      mode === 'avg'
        ? formatPercent(readCacheHitRate(value))
        : formatCacheAggregateValue(value);
    return `${formatAggregateLabel(mode).toUpperCase()}: ${rendered}`;
  }).join('\n');
}

function formatAggregateLabel(aggregate: EvalStatAggregate): string {
  if (aggregate === 'avg') return 'avg';
  if (aggregate === 'sum') return 'sum';
  if (aggregate === 'min') return 'min';
  if (aggregate === 'max') return 'max';
  if (aggregate === 'best') return 'best';
  return 'worst';
}

function formatAggregateTooltip(
  values: number[],
  columnDef: ColumnDef,
): string {
  return EVAL_STAT_AGGREGATE_MODES.map((mode) => {
    const value = aggregateColumn(values, mode);
    const rendered =
      value === null ? EM_DASH : formatNumericCellValue(columnDef, value);
    return `${formatAggregateLabel(mode).toUpperCase()}: ${rendered}`;
  }).join('\n');
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

function collectDurationValues(cases: CaseRow[]): number[] {
  const values: number[] = [];
  for (const row of cases) {
    if (typeof row.durationMs === 'number' && Number.isFinite(row.durationMs)) {
      values.push(row.durationMs);
    }
  }
  return values;
}

function collectCacheHitEntries(cases: CaseRow[]): CacheHitEntry[] {
  const entries: CacheHitEntry[] = [];
  for (const row of cases) {
    const operations = row.cacheOperations ?? 0;
    if (!Number.isFinite(operations) || operations <= 0) continue;
    const hits = row.cacheHits ?? 0;
    entries.push({ hits: Number.isFinite(hits) ? hits : 0, operations });
  }
  return entries;
}

function readCacheHitRate(entry: CacheHitEntry): number {
  if (entry.operations <= 0) return 0;
  return entry.hits / entry.operations;
}

function aggregateCacheHits(
  entries: CacheHitEntry[],
  mode: EvalStatAggregate,
): CacheHitEntry {
  if (mode === 'sum') {
    const total = { hits: 0, operations: 0 };
    for (const entry of entries) {
      total.hits += entry.hits;
      total.operations += entry.operations;
    }
    return total;
  }
  if (mode === 'avg') {
    const summed = aggregateCacheHits(entries, 'sum');
    return {
      hits: summed.hits / entries.length,
      operations: summed.operations / entries.length,
    };
  }
  const sorted = entries.toSorted((left, right) => {
    const rateDiff = readCacheHitRate(left) - readCacheHitRate(right);
    if (rateDiff !== 0) return rateDiff;
    return left.operations - right.operations;
  });
  const fallback = entries[0];
  if (fallback === undefined) return { hits: 0, operations: 0 };
  if (mode === 'min' || mode === 'worst') return sorted[0] ?? fallback;
  return sorted[sorted.length - 1] ?? fallback;
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
  if (mode === 'min' || mode === 'worst') return Math.min(...values);
  return Math.max(...values);
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
