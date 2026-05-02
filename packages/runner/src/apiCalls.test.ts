import {
  applyDerivedCallAttributes,
  DEFAULT_API_CALLS_CONFIG,
  DEFAULT_LLM_CALLS_CONFIG,
  extractApiCalls,
  resolveApiCallsConfig,
  type EvalTraceSpan,
} from '@agent-evals/shared';
import { expect, test } from 'vitest';

test('resolveApiCallsConfig fills defaults for empty input', () => {
  expect(resolveApiCallsConfig(undefined)).toEqual(DEFAULT_API_CALLS_CONFIG);
  expect(resolveApiCallsConfig({})).toEqual(DEFAULT_API_CALLS_CONFIG);
  expect(resolveApiCallsConfig({ kinds: [] })).toEqual(
    DEFAULT_API_CALLS_CONFIG,
  );
});

test('resolveApiCallsConfig overrides kinds and merges attributes', () => {
  const resolved = resolveApiCallsConfig({
    kinds: ['undici.request'],
    attributes: { statusCode: 'http.status_code' },
  });

  expect(resolved.kinds).toEqual(['undici.request']);
  expect(resolved.attributes.statusCode).toBe('http.status_code');
  expect(resolved.attributes.method).toBe(
    DEFAULT_API_CALLS_CONFIG.attributes.method,
  );
});

test('resolveApiCallsConfig defaults metric format and placements', () => {
  const resolved = resolveApiCallsConfig({
    metrics: [
      { label: 'Retries', path: 'retryCount' },
      {
        label: 'Payload',
        path: 'payloadBytes',
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
      label: 'Payload',
      tooltip: undefined,
      path: 'payloadBytes',
      format: 'number',
      numberFormat: undefined,
      placements: ['header', 'body'],
    },
  ]);
});

function apiSpan(overrides: Partial<EvalTraceSpan> = {}): EvalTraceSpan {
  return {
    id: 'span-1',
    parentId: null,
    caseId: 'case-1',
    kind: 'api',
    name: 'fetch-account',
    startedAt: '2026-04-21T12:00:00.000Z',
    endedAt: '2026-04-21T12:00:00.142Z',
    status: 'ok',
    attributes: {
      method: 'GET',
      url: 'https://api.example.test/accounts/123?expand=plan',
      statusCode: 200,
      request: { headers: { accept: 'application/json' } },
      response: { ok: true },
      requestBody: { accountId: '123' },
      responseBody: { plan: 'pro' },
      headers: { 'x-request-id': 'req_123' },
      durationMs: 37,
    },
    ...overrides,
  };
}

test('extractApiCalls filters by configured kinds and projects defaults', () => {
  const spans: EvalTraceSpan[] = [
    apiSpan(),
    apiSpan({ id: 'span-2', kind: 'tool', name: 'search' }),
  ];

  const calls = extractApiCalls(spans, DEFAULT_API_CALLS_CONFIG);

  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    id: 'span-1',
    name: 'fetch-account',
    kind: 'api',
    status: 'ok',
    method: 'GET',
    url: 'https://api.example.test/accounts/123?expand=plan',
    statusCode: 200,
    durationMs: 37,
    request: { headers: { accept: 'application/json' } },
    response: { ok: true },
    requestBody: { accountId: '123' },
    responseBody: { plan: 'pro' },
    headers: { 'x-request-id': 'req_123' },
    errorPayload: undefined,
    error: null,
    warnings: [],
  });
});

test('extractApiCalls reads custom attributes and metrics', () => {
  const config = resolveApiCallsConfig({
    kinds: ['http.client'],
    attributes: {
      method: 'http.method',
      url: 'http.url',
      statusCode: 'http.status_code',
      durationMs: 'timing.totalMs',
      error: 'http.error',
    },
    metrics: [
      {
        label: 'Retries',
        path: 'retryCount',
        format: 'number',
        placements: ['header', 'body'],
      },
      { label: 'Cached', path: 'cached', format: 'boolean' },
      { label: 'Missing', path: 'never.set' },
    ],
  });

  const spans = [
    apiSpan({
      kind: 'http.client',
      attributes: {
        http: {
          method: 'POST',
          url: 'https://api.example.test/orders',
          status_code: '201',
          error: { code: 'none' },
        },
        timing: { totalMs: 88 },
        retryCount: 0,
        cached: false,
      },
    }),
  ];

  const [call] = extractApiCalls(spans, config);

  expect(call).toMatchObject({
    method: 'POST',
    url: 'https://api.example.test/orders',
    statusCode: 201,
    durationMs: 88,
    errorPayload: { code: 'none' },
  });
  expect(call?.metrics).toEqual([
    {
      label: 'Retries',
      tooltip: undefined,
      rawValue: 0,
      format: 'number',
      numberFormat: undefined,
      placements: ['header', 'body'],
    },
    {
      label: 'Cached',
      tooltip: undefined,
      rawValue: false,
      format: 'boolean',
      numberFormat: undefined,
      placements: ['body'],
    },
  ]);
});

test('extractApiCalls reads metrics from derived attributes', () => {
  const config = resolveApiCallsConfig({
    derivedAttributes: {
      payloadBytes: ({ get }) => {
        const requestBytes = get('payload.requestBytes');
        const responseBytes = get('payload.responseBytes');
        if (typeof requestBytes !== 'number') return undefined;
        if (typeof responseBytes !== 'number') return undefined;
        return requestBytes + responseBytes;
      },
    },
    metrics: [
      { label: 'Payload Bytes', path: 'payloadBytes', format: 'number' },
    ],
  });

  const spans = [
    apiSpan({
      attributes: { payload: { requestBytes: 12, responseBytes: 30 } },
    }),
  ];

  expect(extractApiCalls(spans, config)[0]?.metrics).toEqual([]);

  const spansWithDerivedAttributes = applyDerivedCallAttributes({
    spans,
    llmCallsConfig: { ...DEFAULT_LLM_CALLS_CONFIG, kinds: [] },
    apiCallsConfig: config,
  });
  expect(spansWithDerivedAttributes[0]?.attributes?.payloadBytes).toBe(42);
  expect(
    extractApiCalls(spansWithDerivedAttributes, config)[0]?.metrics,
  ).toMatchObject([{ label: 'Payload Bytes', rawValue: 42, format: 'number' }]);
});

test('applyDerivedCallAttributes supports object-returning API derived attributes', () => {
  const config = resolveApiCallsConfig({
    derivedAttributes: ({ get }) => {
      const requestBytes = get('payload.requestBytes');
      const responseBytes = get('payload.responseBytes');
      if (typeof requestBytes !== 'number') return undefined;
      if (typeof responseBytes !== 'number') return undefined;
      const payloadBytes = requestBytes + responseBytes;

      return { payloadBytes, 'payload.kilobytes': payloadBytes / 1024 };
    },
  });

  const spansWithDerivedAttributes = applyDerivedCallAttributes({
    spans: [
      apiSpan({
        attributes: { payload: { requestBytes: 256, responseBytes: 768 } },
      }),
    ],
    llmCallsConfig: { ...DEFAULT_LLM_CALLS_CONFIG, kinds: [] },
    apiCallsConfig: config,
  });

  expect(spansWithDerivedAttributes[0]?.attributes).toMatchObject({
    payloadBytes: 1024,
    payload: { requestBytes: 256, responseBytes: 768, kilobytes: 1 },
  });
});

test('extractApiCalls keeps rows with missing optional attributes', () => {
  const [call] = extractApiCalls(
    [apiSpan({ attributes: {} })],
    DEFAULT_API_CALLS_CONFIG,
  );

  expect(call).toMatchObject({
    method: null,
    url: null,
    statusCode: null,
    durationMs: 142,
    request: undefined,
    response: undefined,
    requestBody: undefined,
    responseBody: undefined,
    headers: undefined,
  });
});

test('extractApiCalls carries warnings and captured errors', () => {
  const [call] = extractApiCalls(
    [
      apiSpan({
        status: 'error',
        error: { name: 'ApiError', message: 'Request failed' },
        warnings: [{ message: 'Retry budget exhausted' }],
      }),
    ],
    DEFAULT_API_CALLS_CONFIG,
  );

  expect(call).toMatchObject({
    status: 'error',
    error: { name: 'ApiError', message: 'Request failed' },
    warnings: [{ message: 'Retry budget exhausted' }],
  });
});
