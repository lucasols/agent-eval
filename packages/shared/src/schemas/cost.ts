import { z } from 'zod/v4';

/** Schema for cost totals aggregated over one eval or run. */
export const evalCostSummarySchema = z.object({
  totalUsd: z.number().nullable(),
  uncachedUsd: z.number().nullable(),
  savingsUsd: z.number().nullable(),
});
/** Aggregate cost totals for a run or case collection. */
export type EvalCostSummary = z.infer<typeof evalCostSummarySchema>;

/** Schema for model pricing rates expressed per million tokens. */
export const modelPricingSchema = z.object({
  inputPerMillionUsd: z.number(),
  outputPerMillionUsd: z.number(),
});
/** Per-model token pricing used to estimate eval cost. */
export type ModelPricing = z.infer<typeof modelPricingSchema>;

/** Pricing table keyed by model identifier. */
export type PricingRegistry = Record<string, ModelPricing>;
