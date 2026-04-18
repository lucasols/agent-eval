import { z } from 'zod/v4';

/** Schema for the API request that starts a new eval run. */
export const createRunRequestSchema = z.object({
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  trials: z.number().min(1),
});
/** Request payload accepted by the run creation endpoint. */
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
