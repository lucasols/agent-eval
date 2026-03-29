import type { ModelPricing, PricingRegistry } from '@agent-evals/shared';

export function createPriceRegistry(
  entries: Record<string, ModelPricing>,
): PricingRegistry {
  return entries;
}

export function estimateCost(
  modelId: string,
  usage: { inputTokens?: number; outputTokens?: number },
  registry: PricingRegistry,
): number | null {
  const pricing = registry[modelId];
  if (!pricing) return null;

  const inputCost =
    ((usage.inputTokens ?? 0) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost =
    ((usage.outputTokens ?? 0) / 1_000_000) * pricing.outputPerMillionUsd;

  return inputCost + outputCost;
}
