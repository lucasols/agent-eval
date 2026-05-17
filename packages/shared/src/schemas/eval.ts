import { z } from 'zod/v4';
import { traceCacheRefSchema } from './cache.ts';
import { evalChartsConfigSchema } from './chart.ts';
import {
  cellValueSchema,
  columnDefSchema,
  columnFormatSchema,
  numberDisplayOptionsSchema,
} from './display.ts';
import { manualInputDescriptorSchema } from './manualInput.ts';
import { traceDisplayConfigSchema, traceSpanSchema } from './trace.ts';

/** Freshness signal derived from the latest relevant run plus git state. */
export const evalFreshnessStatusSchema = z.enum(['fresh', 'stale', 'outdated']);
/** Freshness signal derived from the latest relevant run plus git state. */
export type EvalFreshnessStatus = z.infer<typeof evalFreshnessStatusSchema>;

/**
 * Reducer used to collapse per-case values into a single duration or column
 * stat.
 * `best` selects the highest finite value and `worst` selects the lowest.
 */
export const evalStatAggregateSchema = z.enum([
  'avg',
  'min',
  'max',
  'sum',
  'best',
  'worst',
]);
/**
 * Reducer used to collapse per-case values into a single duration or column
 * stat.
 * `best` selects the highest finite value and `worst` selects the lowest.
 */
export type EvalStatAggregate = z.infer<typeof evalStatAggregateSchema>;

const hideIfNoValueShape = {
  /**
   * Hide this stat in the UI when the current run has no displayable value.
   * Missing values, `null`, and empty strings count as no value; `0` remains
   * visible.
   */
  hideIfNoValue: z.boolean().optional(),
};

/**
 * One entry in the EvalCard stats row. Built-in kinds read from the latest run;
 * `duration` aggregates per-case durations, `cacheHits` counts Agent Eval
 * operation-level cache hits from spans and `evalTracer.cache(...)` refs, not
 * LLM provider prompt-cache read tokens. Cache hits use an independent
 * aggregate mode and default to `sum`. `column` aggregates a score or numeric
 * output column across the latest run.
 */
export const evalStatItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cases'), ...hideIfNoValueShape }),
  z.object({
    kind: z.literal('passRate'),
    accent: z.boolean().optional(),
    ...hideIfNoValueShape,
  }),
  z.object({
    kind: z.literal('duration'),
    aggregate: evalStatAggregateSchema.optional(),
    ...hideIfNoValueShape,
  }),
  z.object({
    kind: z.literal('cacheHits'),
    aggregate: evalStatAggregateSchema.optional(),
    ...hideIfNoValueShape,
  }),
  z.object({
    kind: z.literal('column'),
    key: z.string(),
    label: z.string().optional(),
    aggregate: evalStatAggregateSchema,
    format: columnFormatSchema.optional(),
    /** Number presentation options applied when `format: 'number'`. */
    numberFormat: numberDisplayOptionsSchema.optional(),
    accent: z.boolean().optional(),
    ...hideIfNoValueShape,
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
  /**
   * Stable eval identity derived from the workspace-relative file path and
   * authored eval id. Older clients should display `id`; callers that need an
   * exact eval must use `key`.
   */
  key: z.string().default(''),
  id: z.string(),
  title: z.string().optional(),
  /** Eval file path relative to the active workspace root. */
  filePath: z.string(),
  /** Effective eval-level tags inherited by every case in this eval. */
  tags: z.array(z.string()).optional(),
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
  /** Authored case ids discovered for this eval, when case generation has run. */
  caseIds: z.array(z.string()).optional(),
  lastRunStatus: z
    .enum(['pass', 'fail', 'error', 'running', 'cancelled', 'unscored'])
    .nullable(),
  /**
   * Optional per-eval stats row configuration for the EvalCard. Opt-in: when
   * omitted or empty, the UI renders no stats row at all.
   */
  stats: evalStatsConfigSchema.optional(),
  /**
   * Initial aggregate mode used for duration and column stats on this eval
   * card. Overrides workspace-level `defaultStatAggregate` when present.
   */
  defaultStatAggregate: evalStatAggregateSchema.optional(),
  /**
   * Ordered per-eval history chart configuration for the EvalCard. Opt-in:
   * when omitted or empty, the UI renders no history chart at all.
   */
  charts: evalChartsConfigSchema.optional(),
  /**
   * Manual-input form descriptor when the eval declares `manualInput`. The
   * web UI renders these fields in a modal before kicking off a run; the
   * runner consumes the validated values as the case input.
   */
  manualInput: manualInputDescriptorSchema.optional(),
});
/** Metadata shown for one discovered eval in the explorer UI. */
export type EvalSummary = z.infer<typeof evalSummarySchema>;

/** Schema for one case row in an eval run result table. */
export const caseRowSchema = z.object({
  /**
   * Stable eval identity for this case row. Legacy rows may omit it and fall
   * back to `evalId`.
   */
  evalKey: z.string().optional(),
  /**
   * Stable case identity derived from file path, eval id, and case id. Legacy
   * rows may omit it and fall back to `caseId`.
   */
  caseKey: z.string().optional(),
  caseId: z.string(),
  evalId: z.string(),
  /** Effective tags for this case, including workspace/eval/case tags. */
  tags: z.array(z.string()).optional(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  /** Elapsed case execution duration in milliseconds, or null before completion. */
  durationMs: z.number().nullable(),
  /**
   * Agent Eval operation-level cache hits recorded for this case.
   *
   * This counts persisted operation cache hits from spans and
   * `evalTracer.cache(...)` refs. It does not count LLM provider prompt-cache
   * read tokens such as `cachedInputTokens`. Older run artifacts may omit it
   * and should be treated as zero by aggregate readers.
   */
  cacheHits: z.number().optional(),
  /**
   * Agent Eval operation-level cache activity entries recorded for this case.
   *
   * This is the denominator for `cacheHits`, counting hits plus misses and
   * refreshes that appear in the Cache tab. Older run artifacts may omit it
   * and should be treated as zero by aggregate readers.
   */
  cacheOperations: z.number().optional(),
  costUsd: z.number().nullable().optional(),
  columns: z.record(z.string(), cellValueSchema),
  /**
   * Runtime column definitions authored by output helpers for this case.
   * These complement eval-level `columns` without changing discovery metadata.
   */
  outputColumnDefs: z.array(columnDefSchema).optional(),
  /** Winning trial index for the persisted case result. */
  trial: z.number(),
});
/** Flattened per-case row rendered in run tables and streamed updates. */
export type CaseRow = z.infer<typeof caseRowSchema>;

/** Structured assertion failure metadata captured for one case run. */
export const assertionFailureSchema = z.object({
  /**
   * Error class or category label rendered alongside the message (e.g.
   * `EvalAssertionError`, `OutputsSchemaError`). Optional for legacy entries
   * and synthetic failures without an originating Error.
   */
  name: z.string().optional(),
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
export const runLogLocationSchema = z.object({
  /** File path reported by the JavaScript stack frame. */
  file: z.string(),
  /** 1-based source line reported by the JavaScript stack frame. */
  line: z.number(),
  /** 1-based source column reported by the JavaScript stack frame. */
  column: z.number(),
  /**
   * Full JavaScript stack captured when the log was emitted.
   *
   * Older run artifacts may only include the primary file, line, and column.
   */
  stack: z.string().optional(),
});
/** Best-effort source location and captured stack for one case log. */
export type RunLogLocation = z.infer<typeof runLogLocationSchema>;

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
  /** Best-effort code location for the log call, when Node stack data is available. */
  location: runLogLocationSchema.optional(),
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
  /**
   * Value-cache refs recorded by `evalTracer.cache(...)` calls made directly
   * from the score compute body, with no surrounding scorer span.
   */
  cacheRefs: z.array(traceCacheRefSchema).default([]),
});
/** Trace payload captured while computing one score for a case. */
export type ScoreTrace = z.infer<typeof scoreTraceSchema>;

/** Schema for the detailed payload shown when opening a specific case. */
export const caseDetailSchema = z.object({
  /** Stable eval identity for this case detail. */
  evalKey: z.string().optional(),
  /** Stable case identity for this case detail. */
  caseKey: z.string().optional(),
  caseId: z.string(),
  evalId: z.string(),
  /** Effective tags for this case, including workspace/eval/case tags. */
  tags: z.array(z.string()).optional(),
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
  /**
   * Runtime column definitions authored by output helpers for this case.
   * These complement eval-level `columns` without changing discovery metadata.
   */
  outputColumnDefs: z.array(columnDefSchema).optional(),
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

/** Schema for discovery problems that should be shown before running evals. */
export const discoveryIssueSchema = z.object({
  type: z.enum([
    'duplicate-eval-id',
    'manual-input-with-cases',
    'invalid-tags',
  ]),
  severity: z.enum(['error']),
  filePath: z.string(),
  evalId: z.string(),
  message: z.string(),
});
/** Discovery problem found while scanning eval files. */
export type DiscoveryIssue = z.infer<typeof discoveryIssueSchema>;
