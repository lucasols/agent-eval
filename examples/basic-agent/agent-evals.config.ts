import type { AgentEvalsConfig } from '@ls-stack/agent-eval';

export const config: AgentEvalsConfig = {
  include: ['evals/**/*.eval.ts'],
  defaultTrials: 1,
  trialSelection: 'lowestScore',
  concurrency: 2,
  staleAfterDays: 14,
  traceDisplay: {
    attributes: [
      {
        path: 'input',
        label: 'Input',
        format: 'json',
        placements: ['section'],
      },
      {
        path: 'output',
        label: 'Output',
        format: 'json',
        placements: ['section'],
      },
    ],
  },
};
