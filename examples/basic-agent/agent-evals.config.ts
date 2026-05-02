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
  columns: {
    toolCalls: { label: 'Tool Calls' },
    llmTurns: { label: 'LLM Turns' },
  },
  deriveFromTracing: {
    toolCalls: ({ trace }) => trace.findSpansByKind('tool').length,
    llmTurns: ({ trace }) => trace.findSpansByKind('llm').length,
  },
  llmCalls: {
    derivedAttributes: ({ get }) => {
      const inputTokens = get('usage.inputTokens');
      const outputTokens = get('usage.outputTokens');
      const cachedInputTokens = get('usage.cachedInputTokens');
      if (typeof inputTokens !== 'number') return undefined;
      if (typeof outputTokens !== 'number') return undefined;
      const billableTokens =
        inputTokens +
        outputTokens -
        (typeof cachedInputTokens === 'number' ? cachedInputTokens : 0);

      return {
        'usage.billableTokens': billableTokens,
        'usage.billableOutputShare':
          billableTokens === 0 ? undefined : outputTokens / billableTokens,
      };
    },
    pricing: {
      'gpt-4o-mini': {
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
        cachedInputUsdPerMillion: 0.25,
        cacheCreationInputUsdPerMillion: 3.125,
      },
      'gpt-4o': {
        provider: 'openai',
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
      },
      'whisper-1': {
        provider: 'openai',
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
      },
      'o1-mini': {
        provider: 'openai',
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
        reasoningUsdPerMillion: 60,
      },
      'claude-3-5-sonnet': {
        provider: 'anthropic',
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
      },
      'gpt-4o-vision-preview': {
        provider: 'openai',
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
      },
    },
    metrics: [
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
        numberFormat: { minDecimalPlaces: 2, maxDecimalPlaces: 2 },
        placements: ['body'],
      },
      {
        label: 'Streamed',
        path: 'streamed',
        format: 'boolean',
        placements: ['body'],
      },
      {
        label: 'Billable Tokens',
        path: 'usage.billableTokens',
        format: 'number',
        placements: ['body'],
      },
      {
        label: 'Billable Output Share',
        path: 'usage.billableOutputShare',
        format: 'number',
        numberFormat: { minDecimalPlaces: 2, maxDecimalPlaces: 2 },
        placements: ['body'],
      },
    ],
  },
  apiCalls: {
    metrics: [
      {
        label: 'Retries',
        path: 'retryCount',
        format: 'number',
        placements: ['header', 'body'],
      },
      { label: 'Source', path: 'source', placements: ['body'] },
    ],
  },
};
