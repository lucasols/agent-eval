import { z } from 'zod/v4';
import { evalCostSummarySchema } from './cost.ts';

/** Schema for persisted metadata about a single run invocation. */
export const runManifestSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'cancelled', 'error']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  trials: z.number(),
});
/** Persisted lifecycle metadata for a single eval run. */
export type RunManifest = z.infer<typeof runManifestSchema>;

/** Schema for aggregate metrics computed over a completed or active run. */
export const runSummarySchema = z.object({
  runId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'cancelled', 'error']),
  totalCases: z.number(),
  passedCases: z.number(),
  failedCases: z.number(),
  errorCases: z.number(),
  cancelledCases: z.number(),
  averageScore: z.number().nullable(),
  totalDurationMs: z.number().nullable(),
  cost: evalCostSummarySchema,
  errorMessage: z.string().nullable().default(null),
});
/** Roll-up statistics and cost totals for one run. */
export type RunSummary = z.infer<typeof runSummarySchema>;
