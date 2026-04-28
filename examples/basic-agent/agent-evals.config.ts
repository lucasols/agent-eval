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
  llmCalls: {
    metrics: [
      {
        label: 't/s',
        tooltip: 'Tokens per second',
        path: 'tokensPerSecond',
        format: 'number',
        numberFormat: { decimalPlaces: 1 },
        placements: ['header', 'body'],
      },
      {
        label: 'Retries',
        path: 'retryCount',
        format: 'number',
        placements: ['body'],
      },
      {
        label: 'Temperature',
        path: 'params.temperature',
        format: 'number',
        numberFormat: { decimalPlaces: 2 },
        placements: ['body'],
      },
      {
        label: 'Streamed',
        path: 'streamed',
        format: 'boolean',
        placements: ['body'],
      },
    ],
  },
};
