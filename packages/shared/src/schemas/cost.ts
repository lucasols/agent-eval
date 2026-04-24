import { z } from 'zod/v4';

/** Schema for cost totals aggregated over one eval or run. */
export const evalCostSummarySchema = z.object({
  totalUsd: z.number().nullable(),
});
/** Aggregate cost totals for a run or case collection. */
export type EvalCostSummary = z.infer<typeof evalCostSummarySchema>;
