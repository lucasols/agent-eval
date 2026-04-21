import { z } from 'zod/v4';
import { cacheModeSchema } from './cache.ts';
import { evalCostSummarySchema } from './cost.ts';

/** Schema for persisted metadata about a single run invocation. */
export const runManifestSchema = z.object({
  id: z.string(),
  /**
   * Short, human-readable run id (e.g. `r0`, `r1`). Monotonic global counter
   * assigned at creation; oldest run is `r0`. Legacy persisted runs are
   * migrated to have a `shortId` on load.
   */
  shortId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'cancelled', 'error']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  trials: z.number(),
  /** Cache mode used for this run. Defaults to `use` when absent. */
  cacheMode: cacheModeSchema.optional(),
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
