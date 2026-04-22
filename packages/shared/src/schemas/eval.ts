import { z } from 'zod/v4';
import { evalCostSummarySchema } from './cost.ts';
import { cellValueSchema, columnDefSchema } from './display.ts';
import { traceDisplayConfigSchema, traceSpanSchema } from './trace.ts';

/** Freshness signal derived from the latest relevant run plus git state. */
export const evalFreshnessStatusSchema = z.enum(['fresh', 'stale', 'outdated']);
/** Freshness signal derived from the latest relevant run plus git state. */
export type EvalFreshnessStatus = z.infer<typeof evalFreshnessStatusSchema>;

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
    .enum(['pass', 'fail', 'error', 'running', 'cancelled'])
    .nullable(),
});
/** Metadata shown for one discovered eval in the explorer UI. */
export type EvalSummary = z.infer<typeof evalSummarySchema>;

/** Schema for one case row in an eval run result table. */
export const caseRowSchema = z.object({
  caseId: z.string(),
  evalId: z.string(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  latencyMs: z.number().nullable(),
  costUsd: z.number().nullable(),
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

/** Schema for the detailed payload shown when opening a specific case. */
export const caseDetailSchema = z.object({
  caseId: z.string(),
  evalId: z.string(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  input: z.unknown(),
  trace: z.array(traceSpanSchema),
  traceDisplay: traceDisplayConfigSchema,
  cost: evalCostSummarySchema,
  columns: z.record(z.string(), cellValueSchema),
  assertionFailures: z.array(
    z.union([assertionFailureSchema, legacyAssertionFailureSchema]),
  ),
  error: z
    .object({
      name: z.string().optional(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .nullable(),
  /** Winning trial index for the persisted case detail. */
  trial: z.number(),
});
/** Full case payload including inputs, trace, outputs, and failures. */
export type CaseDetail = z.infer<typeof caseDetailSchema>;
