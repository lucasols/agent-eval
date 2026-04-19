import { z } from 'zod/v4';
import { cacheModeSchema } from './cache.ts';

/** Schema for the API request that starts a new eval run. */
export const createRunRequestSchema = z.object({
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  trials: z.number().min(1),
  /**
   * Optional cache controls for the run. When omitted, the cache is used in
   * its default read-through / write-on-miss mode.
   */
  cache: z
    .object({
      mode: cacheModeSchema.default('use'),
    })
    .optional(),
});
/** Request payload accepted by the run creation endpoint. */
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
