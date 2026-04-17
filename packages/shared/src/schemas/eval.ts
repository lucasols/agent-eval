import { z } from 'zod/v4';
import { cellValueSchema, columnDefSchema } from './display.ts';
import { evalCostSummarySchema } from './cost.ts';
import { traceSpanSchema } from './trace.ts';

export const evalSummarySchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  filePath: z.string(),
  stale: z.boolean(),
  columnDefs: z.array(columnDefSchema),
  caseCount: z.number().nullable(),
  lastRunStatus: z.enum(['pass', 'fail', 'error', 'running', 'cancelled']).nullable(),
});
export type EvalSummary = z.infer<typeof evalSummarySchema>;

export const caseRowSchema = z.object({
  caseId: z.string(),
  evalId: z.string(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  score: z.number().nullable(),
  latencyMs: z.number().nullable(),
  costUsd: z.number().nullable(),
  cacheStatus: z.enum(['hit', 'miss', 'partial', 'bypass']).nullable(),
  columns: z.record(z.string(), cellValueSchema),
  trial: z.number(),
});
export type CaseRow = z.infer<typeof caseRowSchema>;

export const caseDetailSchema = z.object({
  caseId: z.string(),
  evalId: z.string(),
  status: z.enum(['pending', 'running', 'pass', 'fail', 'error', 'cancelled']),
  input: z.unknown(),
  trace: z.array(traceSpanSchema),
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
export type CaseDetail = z.infer<typeof caseDetailSchema>;
