import { z } from 'zod/v4';
import { cellValueSchema, columnDefSchema } from './display.ts';
import { evalCostSummarySchema } from './cost.ts';
import { traceDisplayConfigSchema, traceSpanSchema } from './trace.ts';

/** Schema summarizing a discovered eval for list and overview screens. */
export const evalSummarySchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  /** Eval file path relative to the active workspace root. */
  filePath: z.string(),
  stale: z.boolean(),
  columnDefs: z.array(columnDefSchema),
  caseCount: z.number().nullable(),
  lastRunStatus: z.enum(['pass', 'fail', 'error', 'running', 'cancelled']).nullable(),
});
/** Metadata shown for one discovered eval in the explorer UI. */
export type EvalSummary = z.infer<typeof evalSummarySchema>;

/** Schema for one case row in an eval run result table. */
export const caseRowSchema = z.object({
  caseId: z.string(),
  evalId: z.string(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  score: z.number().nullable(),
  latencyMs: z.number().nullable(),
  costUsd: z.number().nullable(),
  columns: z.record(z.string(), cellValueSchema),
  trial: z.number(),
});
/** Flattened per-case row rendered in run tables and streamed updates. */
export type CaseRow = z.infer<typeof caseRowSchema>;

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
  assertionFailures: z.array(z.string()),
  error: z.object({
    name: z.string().optional(),
    message: z.string(),
    stack: z.string().optional(),
  }).nullable(),
  trial: z.number(),
});
/** Full case payload including inputs, trace, outputs, and failures. */
export type CaseDetail = z.infer<typeof caseDetailSchema>;
