import { z } from 'zod/v4';
import { cacheModeSchema } from './api.ts';
import { modelPricingSchema } from './cost.ts';

export type AgentEvalsConfig = {
  workspaceRoot?: string;
  include: string[];
  localStateDir?: string;
  recordedCacheDir?: string;
  defaultCacheMode?: z.infer<typeof cacheModeSchema>;
  defaultTrials?: number;
  pricing?: Record<string, z.infer<typeof modelPricingSchema>>;
  concurrency?: number;
};

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
