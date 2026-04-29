import { z } from 'zod/v4';
import { traceCacheRefSchema } from './cache.ts';
import { evalChartsConfigSchema } from './chart.ts';
import {
  cellValueSchema,
  columnDefSchema,
  columnFormatSchema,
} from './display.ts';
import { traceDisplayConfigSchema, traceSpanSchema } from './trace.ts';

/** Freshness signal derived from the latest relevant run plus git state. */
export const evalFreshnessStatusSchema = z.enum(['fresh', 'stale', 'outdated']);
/** Freshness signal derived from the latest relevant run plus git state. */
export type EvalFreshnessStatus = z.infer<typeof evalFreshnessStatusSchema>;

/** Reducer used to collapse a column's per-case values into a single stat. */
export const evalStatAggregateSchema = z.enum([
  'avg',
  'min',
  'max',
  'sum',
  'last',
]);
/** Reducer used to collapse a column's per-case values into a single stat. */
export type EvalStatAggregate = z.infer<typeof evalStatAggregateSchema>;

/**
 * One entry in the EvalCard stats row. Built-in kinds use latest run totals;
 * `column` aggregates a score or numeric output column across the latest run.
 */
export const evalStatItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cases') }),
  z.object({ kind: z.literal('passRate'), accent: z.boolean().optional() }),
  z.object({ kind: z.literal('duration') }),
  z.object({
    kind: z.literal('column'),
    key: z.string(),
    label: z.string().optional(),
    aggregate: evalStatAggregateSchema,
    format: columnFormatSchema.optional(),
    accent: z.boolean().optional(),
  }),
]);
/** Single stat rendered in the EvalCard stats row. */
export type EvalStatItem = z.infer<typeof evalStatItemSchema>;

/** Ordered list of stats rendered in the EvalCard stats row. */
export const evalStatsConfigSchema = z.array(evalStatItemSchema);
/** Ordered list of stats rendered in the EvalCard stats row. */
export type EvalStatsConfig = z.infer<typeof evalStatsConfigSchema>;

/** Schema summarizing a discovered eval for list and overview screens. */
export const evalSummarySchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  /** Eval file path relative to the active workspace root. */
  filePath: z.string(),
  /** Indicates the eval file changed since the latest passing result. */
  stale: z.boolean(),
  /** Indicates the latest comparable run is from an older commit and too old. */
  outdated: z.boolean(),
  /** Latest derived freshness signal for this eval. */
  freshnessStatus: evalFreshnessStatusSchema,
  /** Timestamp for the latest run considered when deriving freshness. */
  latestRunAt: z.string().nullable(),
  /** Commit SHA recorded on the latest run considered for freshness. */
  latestRunCommitSha: z.string().nullable(),
  /** Current workspace commit SHA when the summary was requested. */
  currentCommitSha: z.string().nullable(),
  columnDefs: z.array(columnDefSchema),
  caseCount: z.number().nullable(),
  lastRunStatus: z
    .enum(['pass', 'fail', 'error', 'running', 'cancelled', 'unscored'])
    .nullable(),
  /**
   * Optional per-eval stats row configuration for the EvalCard. Opt-in: when
   * omitted or empty, the UI renders no stats row at all.
   */
  stats: evalStatsConfigSchema.optional(),
  /**
   * Ordered per-eval history chart configuration for the EvalCard. Opt-in:
   * when omitted or empty, the UI renders no history chart at all.
   */
  charts: evalChartsConfigSchema.optional(),
});
/** Metadata shown for one discovered eval in the explorer UI. */
export type EvalSummary = z.infer<typeof evalSummarySchema>;

/** Schema for one case row in an eval run result table. */
export const caseRowSchema = z.object({
  caseId: z.string(),
  evalId: z.string(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  latencyMs: z.number().nullable(),
  costUsd: z.number().nullable().optional(),
  columns: z.record(z.string(), cellValueSchema),
  /** Winning trial index for the persisted case result. */
  trial: z.number(),
});
/** Flattened per-case row rendered in run tables and streamed updates. */
export type CaseRow = z.infer<typeof caseRowSchema>;

/** Structured assertion failure metadata captured for one case run. */
export const assertionFailureSchema = z.object({
  /** Human-readable assertion failure message shown in the UI and artifacts. */
  message: z.string(),
  /** Stack trace captured from the originating error when available. */
  stack: z.string().optional(),
});
/** Assertion failure metadata captured for one case run. */
export type AssertionFailure = z.infer<typeof assertionFailureSchema>;

const legacyAssertionFailureSchema = z
  .string()
  .transform((message): AssertionFailure => ({ message }));

/** Severity level for one log captured during a case run. */
export const runLogLevelSchema = z.enum(['log', 'info', 'warn', 'error']);
/** Severity level for one log captured during a case run. */
export type RunLogLevel = z.infer<typeof runLogLevelSchema>;

/** Eval runner phase that emitted a captured case log. */
export const runLogPhaseSchema = z.enum([
  'eval',
  'derive',
  'outputsSchema',
  'scorer',
]);
/** Eval runner phase that emitted a captured case log. */
export type RunLogPhase = z.infer<typeof runLogPhaseSchema>;

/** Schema for one persisted log entry captured during a case run. */
export const runLogEntrySchema = z.object({
  /** ISO timestamp for when the log was captured. */
  timestamp: z.string(),
  /** Normalized log level. */
  level: runLogLevelSchema,
  /** Case-owned runner phase that emitted the log. */
  phase: runLogPhaseSchema,
  /** Human-readable preview formatted from the original log arguments. */
  message: z.string(),
  /** JSON-safe captured log arguments rendered in the UI. */
  args: z.array(z.unknown()).default([]),
  /** Whether `message` was capped before persistence. */
  truncated: z.boolean().default(false),
  /**
   * Optional source label for logs emitted from a nested case-owned activity,
   * such as a score key.
   */
  source: z.string().optional(),
});
/** Persisted log entry captured during a case run. */
export type RunLogEntry = z.infer<typeof runLogEntrySchema>;

/** Trace payload captured while computing one score for a case. */
export const scoreTraceSchema = z.object({
  trace: z.array(traceSpanSchema),
  traceDisplay: traceDisplayConfigSchema,
});
/** Trace payload captured while computing one score for a case. */
export type ScoreTrace = z.infer<typeof scoreTraceSchema>;

/** Schema for the detailed payload shown when opening a specific case. */
export const caseDetailSchema = z.object({
  caseId: z.string(),
  evalId: z.string(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  input: z.unknown(),
  trace: z.array(traceSpanSchema),
  traceDisplay: traceDisplayConfigSchema,
  /**
   * Separate trace payloads emitted by score computation. These are kept out
   * of `trace` so derive-from-execution metrics do not include judge/scorer
   * work.
   */
  scoringTraces: z.record(z.string(), scoreTraceSchema).optional(),
  columns: z.record(z.string(), cellValueSchema),
  assertionFailures: z.array(
    z.union([assertionFailureSchema, legacyAssertionFailureSchema]),
  ),
  /** Logs captured from manual `evalLog(...)` calls and enabled console calls. */
  logs: z.array(runLogEntrySchema).default([]),
  error: z
    .object({
      name: z.string().optional(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .nullable(),
  /** Winning trial index for the persisted case detail. */
  trial: z.number(),
  /**
   * Value-cache refs recorded by `evalTracer.cache(...)` calls made directly
   * from the case body (with no surrounding `traceSpan`). Span-bound refs are
   * stored on each owning span's `cache.refs` attribute instead.
   */
  cacheRefs: z.array(traceCacheRefSchema).default([]),
});
/** Full case payload including inputs, trace, outputs, and failures. */
export type CaseDetail = z.infer<typeof caseDetailSchema>;
