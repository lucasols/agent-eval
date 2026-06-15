import {
  extractLlmCalls,
  resolveLlmCallsConfig,
  simulateLlmCallCost,
  type EvalTraceSpan,
} from '@agent-evals/shared';
import { expect, test } from 'vitest';

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
      latencyMs: 42,
      usage: { inputTokens: 150, outputTokens: 50 },
      input: { prompt: 'hi' },
      output: { reply: 'hello' },
    },
    ...overrides,
  };
}

const fullPricing = {
  'gpt-4o-mini': {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 0.25,
    cacheCreationInputUsdPerMillion: 3.125,
    cacheCreationInput1hUsdPerMillion: 6.25,
  },
};

test('simulateLlmCallCost returns recorded values for actual scenario', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cachedInputTokens: 300,
          cacheCreationInputTokens: 200,
        },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const actual = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'actual',
  });

  expect(actual.inputCostUsd).toBe(entry.inputCostUsd);
  expect(actual.cachedInputCostUsd).toBe(entry.cachedInputCostUsd);
  expect(actual.cacheCreationInputCostUsd).toBe(
    entry.cacheCreationInputCostUsd,
  );
  expect(actual.outputCostUsd).toBe(entry.outputCostUsd);
  expect(actual.totalCostUsd).toBe(entry.costUsd);
});

test('simulateLlmCallCost noCache bills every input token at base rate', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cachedInputTokens: 300,
          cacheCreationInputTokens: 200,
        },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'noCache',
  });

  expect(sim.inputCostUsd).toBeCloseTo(0.0025);
  expect(sim.cachedInputCostUsd).toBe(0);
  expect(sim.cacheCreationInputCostUsd).toBe(0);
  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.totalCostUsd).toBeCloseTo(0.0045);
});

test('simulateLlmCallCost does not require reasoning pricing when output tokens include reasoning', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: { inputTokens: 1_000, outputTokens: 200, reasoningTokens: 80 },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'noCache',
  });

  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.reasoningCostUsd).toBe(0);
  expect(sim.totalCostUsd).toBeCloseTo(0.0045);
});

test('simulateLlmCallCost withBaseCaching treats every cacheable token as a cache read when caching is in use', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cachedInputTokens: 300,
          cacheCreationInputTokens: 200,
          cacheCreationInput1hTokens: 80,
        },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'withBaseCaching',
  });

  // baseInput = 500 × 2.5/M
  expect(sim.inputCostUsd).toBeCloseTo(0.00125);
  // (300 + 200) × 0.25/M — all cacheable tokens read in steady state
  expect(sim.cachedInputCostUsd).toBeCloseTo(0.000125);
  // cache writes treated as free (already paid on a previous call)
  expect(sim.cacheCreationInputCostUsd).toBe(0);
  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.totalCostUsd).toBeCloseTo(0.003375);
});

test('simulateLlmCallCost withBaseCaching treats every input token as a cache read when actual has no caching', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: { inputTokens: 1_000, outputTokens: 200 },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'withBaseCaching',
  });

  expect(sim.inputCostUsd).toBe(0);
  expect(sim.cachedInputCostUsd).toBeCloseTo(0.00025);
  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.totalCostUsd).toBeCloseTo(0.00225);
});

test('simulateLlmCallCost withBaseCachingWrite treats every cacheable token as a base cache write when caching is in use', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cachedInputTokens: 300,
          cacheCreationInputTokens: 200,
          cacheCreationInput1hTokens: 80,
        },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'withBaseCachingWrite',
  });

  expect(sim.inputCostUsd).toBeCloseTo(0.00125);
  // No cache reads on first call
  expect(sim.cachedInputCostUsd).toBe(0);
  // (300 + 200) × 3.125/M — every cacheable token written at the 5m rate
  expect(sim.cacheCreationInputCostUsd).toBeCloseTo(0.0015625);
  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.totalCostUsd).toBeCloseTo(0.0048125);
});

test('simulateLlmCallCost withBaseCachingWrite treats every input token as a cache write when actual has no caching', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: { inputTokens: 1_000, outputTokens: 200 },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'withBaseCachingWrite',
  });

  expect(sim.inputCostUsd).toBe(0);
  expect(sim.cachedInputCostUsd).toBe(0);
  // 1000 × 3.125/M
  expect(sim.cacheCreationInputCostUsd).toBeCloseTo(0.003125);
  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.totalCostUsd).toBeCloseTo(0.005125);
});

test('simulateLlmCallCost withExtendedCachingWrite treats every cacheable token as an extended cache write when caching is in use', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cachedInputTokens: 300,
          cacheCreationInputTokens: 200,
          cacheCreationInput1hTokens: 50,
        },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'withExtendedCachingWrite',
  });

  expect(sim.inputCostUsd).toBeCloseTo(0.00125);
  expect(sim.cachedInputCostUsd).toBe(0);
  // (300 + 200) × 6.25/M — every cacheable token written at the extended rate
  expect(sim.cacheCreationInputCostUsd).toBeCloseTo(0.003125);
  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.totalCostUsd).toBeCloseTo(0.006375);
});

test('simulateLlmCallCost withExtendedCachingWrite treats every input token as a 1h cache write when actual has no caching', () => {
  const config = resolveLlmCallsConfig({ pricing: fullPricing });
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'gpt-4o-mini',
        usage: { inputTokens: 1_000, outputTokens: 200 },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'withExtendedCachingWrite',
  });

  expect(sim.inputCostUsd).toBe(0);
  expect(sim.cachedInputCostUsd).toBe(0);
  // 1000 × 6.25/M
  expect(sim.cacheCreationInputCostUsd).toBeCloseTo(0.00625);
  expect(sim.outputCostUsd).toBeCloseTo(0.002);
  expect(sim.totalCostUsd).toBeCloseTo(0.00825);
});

test('simulateLlmCallCost falls back to null when pricing is missing', () => {
  const config = resolveLlmCallsConfig({});
  const spans: EvalTraceSpan[] = [
    llmSpan({
      attributes: {
        model: 'unknown-model',
        usage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cachedInputTokens: 300,
          cacheCreationInputTokens: 200,
        },
      },
    }),
  ];
  const entry = extractLlmCalls(spans, config)[0];
  if (!entry) throw new Error('expected entry');

  const sim = simulateLlmCallCost({
    entry,
    pricing: config.pricing,
    scenario: 'noCache',
  });

  expect(sim.inputCostUsd).toBeNull();
  expect(sim.outputCostUsd).toBeNull();
  expect(sim.totalCostUsd).toBeNull();
});
