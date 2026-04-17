import type { AgentEvalsConfig } from '@agent-evals/shared';

export const config: AgentEvalsConfig = {
  include: ['evals/**/*.eval.ts'],
  defaultTrials: 1,
  pricing: {
    'gpt-4o': {
      inputPerMillionUsd: 2.5,
      outputPerMillionUsd: 10,
    },
    'claude-sonnet-4-20250514': {
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
    },
  },
  concurrency: 2,
  traceDisplay: {
    attributes: [
      { path: 'input', label: 'Input', format: 'json', placements: ['section'] },
      { path: 'output', label: 'Output', format: 'json', placements: ['section'] },
    ],
  },
};
