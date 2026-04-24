import { z } from 'zod/v4';
import { cacheModeSchema } from './cache.ts';
import { trialSelectionModeSchema } from './config.ts';

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
  /**
   * Git commit SHA for the workspace when the run started. Older persisted
   * runs may not include this field.
   */
  commitSha: z.string().nullable().optional().default(null),
  /**
   * Eval-file fingerprints captured for this run, keyed by eval id. Older
   * persisted runs may not include this field.
   */
  evalSourceFingerprints: z
    .record(z.string(), z.string())
    .optional()
    .default({}),
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  /** Number of trial attempts executed for each case in this run. */
  trials: z.number(),
  /**
   * Strategy used to collapse repeated trials into the single persisted case
   * result for this run. Older persisted runs may not include this field.
   */
  trialSelection: trialSelectionModeSchema.optional().default('lowestScore'),
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
  totalDurationMs: z.number().nullable(),
  errorMessage: z.string().nullable().default(null),
});
/** Roll-up statistics for one run. */
export type RunSummary = z.infer<typeof runSummarySchema>;
