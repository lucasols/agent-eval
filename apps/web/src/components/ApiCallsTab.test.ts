import type { ApiCallEntry } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import {
  getApiEndpointLabel,
  getMostCalledApiEndpoints,
} from '#src/components/ApiCallsTab.helpers';

function apiCallEntry({
  id,
  method,
  routeAlias = null,
  url,
}: {
  id: string;
  method: string;
  routeAlias?: string | null;
  url: string;
}): ApiCallEntry {
  return {
    id,
    name: `${method} ${url}`,
    kind: 'api',
    status: 'ok',
    method,
    url,
    routeAlias,
    statusCode: 200,
    durationMs: 10,
    request: undefined,
    response: undefined,
    requestBody: undefined,
    responseBody: undefined,
    headers: undefined,
    errorPayload: undefined,
    metrics: [],
    warnings: [],
    error: null,
  };
}

test('keeps every API endpoint in the most-called chart data', () => {
  const endpoints = getMostCalledApiEndpoints([
    apiCallEntry({
      id: 'object-list-1',
      method: 'POST',
      url: 'http://localhost:8082/object/list',
    }),
    apiCallEntry({
      id: 'object-list-2',
      method: 'POST',
      url: 'http://localhost:8082/object/list?cursor=next',
    }),
    apiCallEntry({
      id: 'org-get',
      method: 'POST',
      url: 'http://localhost:8082/org/get',
    }),
    apiCallEntry({
      id: 'object-properties-index',
      method: 'POST',
      url: 'http://localhost:8082/objectProperties/index',
    }),
    apiCallEntry({
      id: 'conversation-get',
      method: 'GET',
      url: 'http://localhost:8082/v3/conversation-messages',
    }),
    apiCallEntry({
      id: 'tabs-table-get',
      method: 'GET',
      url: 'http://localhost:8082/v3/tabs/table_minimal',
    }),
    apiCallEntry({
      id: 'tabs-update-label',
      method: 'POST',
      url: 'http://localhost:8082/tabs/updateLabel',
    }),
    apiCallEntry({
      id: 'tabs-table-put',
      method: 'PUT',
      url: 'http://localhost:8082/v3/tabs/table_minimal',
    }),
    apiCallEntry({
      id: 'object-create-many',
      method: 'POST',
      url: 'http://localhost:8082/object/createMany',
    }),
    apiCallEntry({
      id: 'conversation-post',
      method: 'POST',
      url: 'http://localhost:8082/v3/conversation-messages',
    }),
  ]);

  expect(endpoints).toHaveLength(9);
  expect(endpoints).toEqual([
    {
      key: 'POST localhost:8082/object/list',
      label: 'POST /object/list',
      fullLabel: 'POST localhost:8082/object/list',
      count: 2,
    },
    {
      key: 'GET localhost:8082/v3/conversation-messages',
      label: 'GET /v3/conversation-messages',
      fullLabel: 'GET localhost:8082/v3/conversation-messages',
      count: 1,
    },
    {
      key: 'GET localhost:8082/v3/tabs/table_minimal',
      label: 'GET /v3/tabs/table_minimal',
      fullLabel: 'GET localhost:8082/v3/tabs/table_minimal',
      count: 1,
    },
    {
      key: 'POST localhost:8082/object/createMany',
      label: 'POST /object/createMany',
      fullLabel: 'POST localhost:8082/object/createMany',
      count: 1,
    },
    {
      key: 'POST localhost:8082/objectProperties/index',
      label: 'POST /objectProperties/index',
      fullLabel: 'POST localhost:8082/objectProperties/index',
      count: 1,
    },
    {
      key: 'POST localhost:8082/org/get',
      label: 'POST /org/get',
      fullLabel: 'POST localhost:8082/org/get',
      count: 1,
    },
    {
      key: 'POST localhost:8082/tabs/updateLabel',
      label: 'POST /tabs/updateLabel',
      fullLabel: 'POST localhost:8082/tabs/updateLabel',
      count: 1,
    },
    {
      key: 'POST localhost:8082/v3/conversation-messages',
      label: 'POST /v3/conversation-messages',
      fullLabel: 'POST localhost:8082/v3/conversation-messages',
      count: 1,
    },
    {
      key: 'PUT localhost:8082/v3/tabs/table_minimal',
      label: 'PUT /v3/tabs/table_minimal',
      fullLabel: 'PUT localhost:8082/v3/tabs/table_minimal',
      count: 1,
    },
  ]);
});

test('groups chart endpoints by span route alias', () => {
  expect(
    getMostCalledApiEndpoints([
      apiCallEntry({
        id: 'tabs-minimal',
        method: 'PUT',
        routeAlias: '/v3/tabs/:id',
        url: 'http://localhost:8082/v3/tabs/minimal',
      }),
      apiCallEntry({
        id: 'tabs-table-minimal',
        method: 'PUT',
        routeAlias: '/v3/tabs/:id',
        url: 'http://localhost:8082/v3/tabs/table_minimal',
      }),
    ]),
  ).toEqual([
    {
      key: 'PUT localhost:8082/v3/tabs/:id',
      label: 'PUT /v3/tabs/:id',
      fullLabel: 'PUT localhost:8082/v3/tabs/:id',
      count: 2,
    },
  ]);
});

test('handles host-path API call URLs when grouping chart routes', () => {
  expect(
    getMostCalledApiEndpoints([
      apiCallEntry({
        id: 'host-path-url',
        method: 'PUT',
        routeAlias: '/v3/tabs/:id',
        url: 'localhost:8082/v3/tabs/minimal?include=fields',
      }),
    ]),
  ).toEqual([
    {
      key: 'PUT localhost:8082/v3/tabs/:id',
      label: 'PUT /v3/tabs/:id',
      fullLabel: 'PUT localhost:8082/v3/tabs/:id',
      count: 1,
    },
  ]);
});

test('keeps domains visible when chart endpoints span multiple domains', () => {
  expect(
    getMostCalledApiEndpoints([
      apiCallEntry({
        id: 'primary-route',
        method: 'GET',
        url: 'http://api.example.test/v3/tabs/table_minimal',
      }),
      apiCallEntry({
        id: 'secondary-route',
        method: 'GET',
        url: 'http://localhost:8082/v3/tabs/table_minimal',
      }),
    ]),
  ).toEqual([
    {
      key: 'GET api.example.test/v3/tabs/table_minimal',
      label: 'GET api.example.test/v3/tabs/table_minimal',
      fullLabel: 'GET api.example.test/v3/tabs/table_minimal',
      count: 1,
    },
    {
      key: 'GET localhost:8082/v3/tabs/table_minimal',
      label: 'GET localhost:8082/v3/tabs/table_minimal',
      fullLabel: 'GET localhost:8082/v3/tabs/table_minimal',
      count: 1,
    },
  ]);
});

test('keeps request methods distinct for the same endpoint path', () => {
  expect(
    getApiEndpointLabel(
      apiCallEntry({
        id: 'tabs-table-get',
        method: 'GET',
        url: 'http://localhost:8082/v3/tabs/table_minimal',
      }),
    ),
  ).toBe('GET localhost:8082/v3/tabs/table_minimal');
  expect(
    getApiEndpointLabel(
      apiCallEntry({
        id: 'tabs-table-put',
        method: 'PUT',
        url: 'http://localhost:8082/v3/tabs/table_minimal',
      }),
    ),
  ).toBe('PUT localhost:8082/v3/tabs/table_minimal');
});
