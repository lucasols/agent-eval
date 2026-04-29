import {
  DEFAULT_LLM_CALLS_CONFIG,
  extractLlmCalls,
  resolveLlmCallsConfig,
  type EvalTraceSpan,
} from '@agent-evals/shared';
import { expect, test } from 'vitest';

test('resolveLlmCallsConfig fills defaults for empty input', () => {
  expect(resolveLlmCallsConfig(undefined)).toEqual(DEFAULT_LLM_CALLS_CONFIG);
  expect(resolveLlmCallsConfig({})).toEqual(DEFAULT_LLM_CALLS_CONFIG);
  expect(resolveLlmCallsConfig({ kinds: [] })).toEqual(
    DEFAULT_LLM_CALLS_CONFIG,
  );
});

test('resolveLlmCallsConfig overrides kinds and merges attributes', () => {
  const resolved = resolveLlmCallsConfig({
    kinds: ['anthropic.messages'],
    attributes: { cachedInputTokens: 'usage.cache_read_input_tokens' },
  });

  expect(resolved.kinds).toEqual(['anthropic.messages']);
  expect(resolved.attributes.cachedInputTokens).toBe(
    'usage.cache_read_input_tokens',
  );
  expect(resolved.attributes.inputTokens).toBe(
    DEFAULT_LLM_CALLS_CONFIG.attributes.inputTokens,
  );
});

test('resolveLlmCallsConfig defaults metric format and placements', () => {
  const resolved = resolveLlmCallsConfig({
    metrics: [
      { label: 'Retries', path: 'retryCount' },
      {
        label: 'Tokens/sec',
        path: 'tps',
        format: 'number',
        placements: ['header', 'body'],
      },
    ],
  });

  expect(resolved.metrics).toEqual([
    {
      label: 'Retries',
      tooltip: undefined,
      path: 'retryCount',
      format: 'string',
      numberFormat: undefined,
      placements: ['body'],
    },
    {
      label: 'Tokens/sec',
      tooltip: undefined,
      path: 'tps',
      format: 'number',
      numberFormat: undefined,
      placements: ['header', 'body'],
    },
  ]);
});

test('resolveLlmCallsConfig passes through tooltip on metrics', () => {
  const resolved = resolveLlmCallsConfig({
    metrics: [
      {
        label: 't/s',
        tooltip: 'Tokens per second',
        path: 'tokensPerSecond',
        format: 'number',
      },
    ],
  });

  expect(resolved.metrics[0]?.tooltip).toBe('Tokens per second');
});

test('resolveLlmCallsConfig resolves pricing registry entries', () => {
  const resolved = resolveLlmCallsConfig({
    pricing: [
      {
        model: 'gpt-4o-mini',
        provider: 'openai',
        inputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.6,
      },
    ],
  });

  expect(resolved.pricing).toEqual([
    {
      model: 'gpt-4o-mini',
      provider: 'openai',
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.6,
      cachedInputUsdPerMillion: undefined,
      cacheCreationInputUsdPerMillion: undefined,
      reasoningUsdPerMillion: undefined,
    },
  ]);
});

function llmSpan(overrides: Partial<EvalTraceSpan> = {}): EvalTraceSpan {
  return {
    id: 'span-1',
    parentId: null,
    caseId: 'case-1',
    kind: 'llm',
    name: 'plan',
    startedAt: '2026-04-21T12:00:00.000Z',
    endedAt: '2026-04-21T12:00:00.142Z',
    status: 'ok',
    attributes: {
      model: 'gpt-4o-mini',
      usage: { inputTokens: 150, outputTokens: 50 },
      costUsd: 0.0015,
      input: { prompt: 'hi' },
      output: { reply: 'hello' },
    },
    ...overrides,
  };
}

test('extractLlmCalls filters by configured kinds and projects defaults', () => {
  const spans: EvalTraceSpan[] = [
    llmSpan(),
    llmSpan({ id: 'span-2', kind: 'tool', name: 'search' }),
  ];

  const calls = extractLlmCalls(spans, DEFAULT_LLM_CALLS_CONFIG);

  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    id: 'span-1',
    name: 'plan',
    kind: 'llm',
    status: 'ok',
    model: 'gpt-4o-mini',
    inputTokens: 150,
    outputTokens: 50,
    totalTokens: 200,
    costUsd: 0.0015,
    inputCostUsd: null,
    outputCostUsd: null,
    cachedInputCostUsd: null,
    cacheCreationInputCostUsd: null,
    reasoningCostUsd: null,
    cacheCreationInputTokens: null,
    latencyMs: 142,
    input: { prompt: 'hi' },
    output: { reply: 'hello' },
    error: null,
    warnings: [],
  });
});

test('extractLlmCalls reads per-token-type cost breakdown', () => {
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'claude-sonnet',
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          cachedInputTokens: 50,
          cacheCreationInputTokens: 80,
        },
        costUsd: 0.0145,
        cost: {
          inputUsd: 0.001,
          outputUsd: 0.0105,
          cachedInputUsd: 0.001,
          cacheCreationInputUsd: 0.002,
        },
      },
    }),
  ];

  expect(extractLlmCalls(spans, DEFAULT_LLM_CALLS_CONFIG)[0]).toMatchObject({
    inputTokens: 100,
    outputTokens: 200,
    cachedInputTokens: 50,
    cacheCreationInputTokens: 80,
    totalTokens: 430,
    inputCostUsd: 0.001,
    outputCostUsd: 0.0105,
    cachedInputCostUsd: 0.001,
    cacheCreationInputCostUsd: 0.002,
    reasoningCostUsd: null,
    costUsd: 0.0145,
  });
});

test('extractLlmCalls derives costs from pricing registry when span costs are missing', () => {
  const config = resolveLlmCallsConfig({
    pricing: [
      {
        model: 'claude-sonnet',
        provider: 'anthropic',
        inputUsdPerMillion: 3,
        outputUsdPerMillion: 15,
        cachedInputUsdPerMillion: 0.3,
        cacheCreationInputUsdPerMillion: 3.75,
        reasoningUsdPerMillion: 60,
      },
    ],
  });

  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'claude-sonnet',
        provider: 'anthropic',
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          cachedInputTokens: 50,
          cacheCreationInputTokens: 80,
          reasoningTokens: 10,
        },
      },
    }),
  ];

  const call = extractLlmCalls(spans, config)[0];

  expect(call?.inputCostUsd).toBeCloseTo(0.0003);
  expect(call?.outputCostUsd).toBeCloseTo(0.003);
  expect(call?.cachedInputCostUsd).toBeCloseTo(0.000015);
  expect(call?.cacheCreationInputCostUsd).toBeCloseTo(0.0003);
  expect(call?.reasoningCostUsd).toBeCloseTo(0.0006);
  expect(call?.costUsd).toBeCloseTo(0.004215);
});

test('extractLlmCalls prefers explicit span costs over derived pricing', () => {
  const config = resolveLlmCallsConfig({
    pricing: [
      {
        model: 'gpt-4o-mini',
        inputUsdPerMillion: 100,
        outputUsdPerMillion: 100,
      },
    ],
  });

  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: { inputTokens: 100, outputTokens: 100 },
        costUsd: 0.5,
        cost: { inputUsd: 0.1 },
      },
    }),
  ];

  expect(extractLlmCalls(spans, config)[0]).toMatchObject({
    inputCostUsd: 0.1,
    outputCostUsd: 0.01,
    costUsd: 0.5,
  });
});

test('extractLlmCalls uses provider-specific pricing before generic pricing', () => {
  const config = resolveLlmCallsConfig({
    pricing: [
      { model: 'shared-model', inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
      {
        model: 'shared-model',
        provider: 'provider-b',
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 3,
      },
    ],
  });

  const calls = extractLlmCalls(
    [
      llmSpan({
        attributes: {
          model: 'shared-model',
          provider: 'provider-b',
          usage: { inputTokens: 100, outputTokens: 100 },
        },
      }),
      llmSpan({
        id: 'span-2',
        attributes: {
          model: 'shared-model',
          provider: 'provider-c',
          usage: { inputTokens: 100, outputTokens: 100 },
        },
      }),
    ],
    config,
  );

  expect(calls[0]?.costUsd).toBe(0.0005);
  expect(calls[1]?.costUsd).toBe(0.0002);
});

test('extractLlmCalls does not derive total cost from incomplete pricing', () => {
  const config = resolveLlmCallsConfig({
    pricing: [{ model: 'gpt-4o-mini', inputUsdPerMillion: 1 }],
  });

  const calls = extractLlmCalls(
    [
      llmSpan({
        attributes: {
          model: 'gpt-4o-mini',
          usage: { inputTokens: 100, outputTokens: 100 },
        },
      }),
    ],
    config,
  );

  expect(calls[0]).toMatchObject({
    inputCostUsd: 0.0001,
    outputCostUsd: null,
    costUsd: null,
  });
});

test('extractLlmCalls derives zero cost for zero-token calls', () => {
  const config = resolveLlmCallsConfig({
    pricing: [{ model: 'gpt-4o-mini', inputUsdPerMillion: 1 }],
  });

  const calls = extractLlmCalls(
    [
      llmSpan({
        attributes: {
          model: 'gpt-4o-mini',
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      }),
    ],
    config,
  );

  expect(calls[0]).toMatchObject({ costUsd: 0 });
});

test('extractLlmCalls reads custom metrics and drops undefined values', () => {
  const config = resolveLlmCallsConfig({
    metrics: [
      {
        label: 'Tokens/sec',
        path: 'tokensPerSecond',
        format: 'number',
        placements: ['header', 'body'],
      },
      { label: 'Retries', path: 'retryCount', format: 'number' },
      { label: 'Streamed', path: 'streamed', format: 'boolean' },
      { label: 'Missing', path: 'never.set' },
    ],
  });

  const spans = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: { inputTokens: 1, outputTokens: 1 },
        tokensPerSecond: 38.2,
        retryCount: 0,
        streamed: false,
      },
    }),
  ];

  const [call] = extractLlmCalls(spans, config);

  expect(call?.metrics).toEqual([
    {
      label: 'Tokens/sec',
      tooltip: undefined,
      rawValue: 38.2,
      format: 'number',
      numberFormat: undefined,
      placements: ['header', 'body'],
    },
    {
      label: 'Retries',
      tooltip: undefined,
      rawValue: 0,
      format: 'number',
      numberFormat: undefined,
      placements: ['body'],
    },
    {
      label: 'Streamed',
      tooltip: undefined,
      rawValue: false,
      format: 'boolean',
      numberFormat: undefined,
      placements: ['body'],
    },
  ]);
});

test('extractLlmCalls reports null latency for running spans and computes total fallback', () => {
  const calls = extractLlmCalls(
    [
      llmSpan({
        endedAt: null,
        status: 'running',
        attributes: { usage: { inputTokens: 12 } },
      }),
    ],
    DEFAULT_LLM_CALLS_CONFIG,
  );

  expect(calls[0]).toMatchObject({
    status: 'running',
    latencyMs: null,
    inputTokens: 12,
    outputTokens: null,
    totalTokens: 12,
  });
});

test('extractLlmCalls supports overridden attribute paths', () => {
  const config = resolveLlmCallsConfig({
    attributes: {
      inputTokens: 'usage.prompt_tokens',
      outputTokens: 'usage.completion_tokens',
      cost: 'pricing.totalUsd',
    },
  });

  const spans = [
    llmSpan({
      attributes: {
        model: 'o1-mini',
        usage: { prompt_tokens: 100, completion_tokens: 200 },
        pricing: { totalUsd: 0.05 },
      },
    }),
  ];

  expect(extractLlmCalls(spans, config)[0]).toMatchObject({
    inputTokens: 100,
    outputTokens: 200,
    costUsd: 0.05,
    totalTokens: 300,
  });
});

test('extractLlmCalls reads steps as a number count', () => {
  const calls = extractLlmCalls(
    [
      llmSpan({
        attributes: {
          model: 'gpt-4o-mini',
          usage: { inputTokens: 10, outputTokens: 5 },
          steps: 3,
        },
      }),
    ],
    DEFAULT_LLM_CALLS_CONFIG,
  );

  expect(calls[0]).toMatchObject({ stepCount: 3, stepDetails: null });
});

test('extractLlmCalls reads steps as an array of step details', () => {
  const stepArray = [
    { text: 'Plan', toolCalls: [{ id: '1', name: 'lookup' }] },
    { text: 'Execute', toolCalls: [{ id: '2', name: 'apply' }] },
  ];

  const calls = extractLlmCalls(
    [
      llmSpan({
        attributes: {
          model: 'gpt-4o',
          usage: { inputTokens: 10, outputTokens: 5 },
          steps: stepArray,
        },
      }),
    ],
    DEFAULT_LLM_CALLS_CONFIG,
  );

  expect(calls[0]).toMatchObject({ stepCount: 2, stepDetails: stepArray });
});
