import { z } from 'zod/v4';
import { modelPricingSchema } from './cost.ts';

export type AgentEvalsConfig = {
  /** Root directory used to resolve all relative paths. Defaults to `process.cwd()`. */
  workspaceRoot?: string;
  /** Glob patterns (relative to `workspaceRoot`) used to discover eval files. */
  include: string[];
  /** Number of trials per case when none is specified. Defaults to `1`. */
  defaultTrials?: number;
  /** Per-model pricing registry used to compute token cost estimates. */
  pricing?: Record<string, z.infer<typeof modelPricingSchema>>;
  /** Maximum number of cases executed in parallel. Defaults to `2`. */
  concurrency?: number;
};

export const agentEvalsConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  include: z.array(z.string()),
  defaultTrials: z.number().optional(),
  pricing: z.record(z.string(), modelPricingSchema).optional(),
  concurrency: z.number().optional(),
});
