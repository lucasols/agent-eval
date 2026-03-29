import { z } from 'zod/v4';
import { cacheModeSchema } from './api.ts';
import { modelPricingSchema } from './cost.ts';

export const agentEvalsConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  include: z.array(z.string()),
  localStateDir: z.string().optional(),
  recordedCacheDir: z.string().optional(),
  defaultCacheMode: cacheModeSchema.optional(),
  defaultTrials: z.number().optional(),
  pricing: z.record(z.string(), modelPricingSchema).optional(),
  concurrency: z.number().optional(),
});
export type AgentEvalsConfig = z.infer<typeof agentEvalsConfigSchema>;
