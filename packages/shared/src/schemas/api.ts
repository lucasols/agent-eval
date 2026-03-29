import { z } from 'zod/v4';

export const cacheModeSchema = z.enum(['off', 'local', 'recorded', 'readonly-recorded']);
export type CacheMode = z.infer<typeof cacheModeSchema>;

export const createRunRequestSchema = z.object({
  target: z.object({
    mode: z.enum(['all', 'evalIds', 'caseIds']),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  cacheMode: cacheModeSchema,
  trials: z.number().min(1),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
