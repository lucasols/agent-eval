import { z } from 'zod/v4';
import { modelPricingSchema } from './cost.ts';
import {
  traceDisplayInputConfigSchema,
  type TraceDisplayInputConfig,
} from './trace.ts';

/** Top-level config authored in `agent-evals.config.ts`. */
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
  /**
   * Global trace attribute display config for the UI.
   *
   * These rules are merged with per-eval `traceDisplay` rules, with the eval
   * definition taking precedence for matching `key` or `path` entries.
   */
  traceDisplay?: TraceDisplayInputConfig;
  /**
   * Optional controls for the operation cache. When omitted, the cache is
   * enabled and stored under `<workspaceRoot>/.agent-evals/cache`.
   */
  cache?: {
    /** Disable the cache entirely; spans with `cache` options execute as if uncached. */
    enabled?: boolean;
    /** Override the directory used to persist cache entries. */
    dir?: string;
  };
};

/** Zod schema for validating `agent-evals.config.ts` input. */
export const agentEvalsConfigSchema = z.object({
  workspaceRoot: z.string().optional(),
  include: z.array(z.string()),
  defaultTrials: z.number().optional(),
  pricing: z.record(z.string(), modelPricingSchema).optional(),
  concurrency: z.number().optional(),
  traceDisplay: traceDisplayInputConfigSchema.optional(),
  cache: z
    .object({
      enabled: z.boolean().optional(),
      dir: z.string().optional(),
    })
    .optional(),
});
