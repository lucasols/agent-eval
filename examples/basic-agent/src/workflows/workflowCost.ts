export type WorkflowUsage = {
  inputTokens: number;
  outputTokens: number;
};

const INPUT_PRICE_PER_MILLION = 2.5;
const OUTPUT_PRICE_PER_MILLION = 10;

export function calculateWorkflowCostUsd(usage: WorkflowUsage): number {
  return (
    (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
    (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION
  );
}
