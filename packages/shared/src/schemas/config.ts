import { z } from 'zod/v4';
import { cacheModeSchema } from './api.ts';
import { modelPricingSchema } from './cost.ts';

export type AgentEvalsConfig = {
  /** Root directory used to resolve all relative paths. Defaults to `process.cwd()`. */
  workspaceRoot?: string;
  /** Glob patterns (relative to `workspaceRoot`) used to discover eval files. */
  include: string[];
  /** Directory for local runner state (runs, local cache). Defaults to `.agent-evals`. */
  localStateDir?: string;
  /** Directory for committed recorded cache artifacts. Defaults to `evals/recordings`. */
  recordedCacheDir?: string;
  /**
   * Cache mode applied to runs when the caller does not specify one.
   * Defaults to `'local'`.
   *
   * Modes:
   * - `'off'`: never read or write cache; every call executes live.
   * - `'local'`: read/write the local cache at `{localStateDir}/cache/local/`.
   *   Intended for fast dev iteration; not committed to source control.
   * - `'recorded'`: read from the committed recorded cache at
   *   `{recordedCacheDir}/cache/` first; on miss, execute live and write the
   *   new entry back to the recorded cache. Used for deterministic/reviewable runs.
   * - `'readonly-recorded'`: read from the recorded cache only. On miss, fail
   *   the operation with a clear error and never write. Suitable for CI to
   *   guarantee reproducible, no-network runs.
   */
  defaultCacheMode?: z.infer<typeof cacheModeSchema>;
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
  localStateDir: z.string().optional(),
  recordedCacheDir: z.string().optional(),
  defaultCacheMode: cacheModeSchema.optional(),
  defaultTrials: z.number().optional(),
  pricing: z.record(z.string(), modelPricingSchema).optional(),
  concurrency: z.number().optional(),
});
