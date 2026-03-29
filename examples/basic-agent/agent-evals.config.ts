import type { AgentEvalsConfig } from '@agent-evals/shared';

export const config: AgentEvalsConfig = {
  include: ['evals/**/*.eval.ts'],
  defaultCacheMode: 'local',
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
};
