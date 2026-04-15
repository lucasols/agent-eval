import { z } from 'zod/v4';

export const createRunRequestSchema = z.object({
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  disableCache: z.boolean().optional(),
  trials: z.number().min(1),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
