import { z } from 'zod/v4';
import { cacheModeSchema } from './api.ts';
import { evalCostSummarySchema } from './cost.ts';

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
  cacheMode: cacheModeSchema,
  trials: z.number(),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

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
});
export type RunSummary = z.infer<typeof runSummarySchema>;
