import { z } from 'zod/v4';

export const evalCostSummarySchema = z.object({
  totalUsd: z.number().nullable(),
  uncachedUsd: z.number().nullable(),
  savingsUsd: z.number().nullable(),
});
export type EvalCostSummary = z.infer<typeof evalCostSummarySchema>;

export const modelPricingSchema = z.object({
  inputPerMillionUsd: z.number(),
  outputPerMillionUsd: z.number(),
});
export type ModelPricing = z.infer<typeof modelPricingSchema>;

export type PricingRegistry = Record<string, ModelPricing>;
