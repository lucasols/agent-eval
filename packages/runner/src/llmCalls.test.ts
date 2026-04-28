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
      path: 'retryCount',
      format: 'string',
      numberFormat: undefined,
      placements: ['body'],
    },
    {
      label: 'Tokens/sec',
      path: 'tps',
      format: 'number',
      numberFormat: undefined,
      placements: ['header', 'body'],
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
    latencyMs: 142,
    input: { prompt: 'hi' },
    output: { reply: 'hello' },
    error: null,
    warnings: [],
  });
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
      rawValue: 38.2,
      format: 'number',
      numberFormat: undefined,
      placements: ['header', 'body'],
    },
    {
      label: 'Retries',
      rawValue: 0,
      format: 'number',
      numberFormat: undefined,
      placements: ['body'],
    },
    {
      label: 'Streamed',
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
