import { z } from 'zod/v4';
import { cacheModeSchema } from './cache.ts';

/** Schema for the API request that starts a new eval run. */
export const createRunRequestSchema = z.object({
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    /** Exact stable eval identities (`filePath + evalId`) selected by UI/API callers. */
    evalKeys: z.array(z.string()).optional(),
    /** Workspace-relative file paths or glob patterns used to filter selected evals. */
    files: z.array(z.string()).optional(),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  trials: z.number().min(1),
  /**
   * Optional cache controls for the run. When omitted, the cache is used in
   * its default read-through / write-on-miss mode.
   */
  cache: z.object({ mode: cacheModeSchema.default('use') }).optional(),
});
/** Request payload accepted by the run creation endpoint. */
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

/** Schema for updating a UI-authored manual score on one persisted case. */
export const updateManualScoreRequestSchema = z.object({
  value: z.number().min(0).max(1).nullable(),
});
/** Request payload accepted by the manual score update endpoint. */
export type UpdateManualScoreRequest = z.infer<
  typeof updateManualScoreRequestSchema
>;
