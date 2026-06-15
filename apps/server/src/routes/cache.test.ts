import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cacheRoutes } from './cache.ts';

const mockRunner = vi.hoisted(() => ({
  getRuns: vi.fn(),
  getRun: vi.fn(),
  getCaseDetail: vi.fn(),
  clearCache: vi.fn(),
}));

vi.mock('../runner.ts', () => ({ getRunnerInstance: () => mockRunner }));

const app = new Hono().route('/cache', cacheRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  mockRunner.clearCache.mockResolvedValue(undefined);
});

describe('cache routes', () => {
  test('clears cache entries recorded by saved runs for one exact eval key', async () => {
    const evalKey = 'evals/refund-workflow.eval.ts#refund-workflow';
    mockRunner.getRuns.mockReturnValue([{ id: 'run-1' }, { id: 'run-2' }]);
    mockRunner.getRun.mockImplementation((runId: string) =>
      runId === 'run-1'
        ? {
            cases: [
              { caseId: 'matching-case', evalKey },
              {
                caseId: 'other-case',
                evalKey: 'evals/receipt-audit.eval.ts#receipt-audit',
              },
            ],
          }
        : { cases: [{ caseId: 'second-matching-case', evalKey }] },
    );
    mockRunner.getCaseDetail.mockImplementation(
      (runId: string, caseId: string) => {
        if (caseId === 'other-case') {
          return {
            cacheRefs: [],
            trace: [
              {
                id: 'ignored-span',
                name: 'ignored',
                attributes: {
                  'cache.status': 'hit',
                  'cache.namespace': 'receipt-manual-namespace',
                  'cache.key': 'ignored-key',
                },
              },
            ],
          };
        }
        return {
          cacheRefs:
            runId === 'run-1'
              ? [
                  {
                    type: 'value',
                    name: 'context',
                    namespace: 'manual-value-namespace',
                    key: 'value-key',
                    status: 'miss',
                  },
                  {
                    type: 'value',
                    name: 'not-stored',
                    namespace: 'manual-value-namespace',
                    key: 'not-stored-key',
                    status: 'miss',
                    stored: false,
                  },
                ]
              : [],
          trace: [
            {
              id: `span-${caseId}`,
              name: 'plan-refund',
              attributes: {
                'cache.status': 'hit',
                'cache.namespace': 'manual-span-namespace',
                'cache.key': 'span-key',
              },
            },
          ],
        };
      },
    );

    const response = await app.request(
      `/cache/actions/eval?evalKey=${encodeURIComponent(evalKey)}`,
      { method: 'DELETE' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deletedEntries: 2,
    });
    expect(mockRunner.clearCache).toHaveBeenCalledTimes(2);
    expect(mockRunner.clearCache).toHaveBeenCalledWith({
      namespace: 'manual-span-namespace',
      key: 'span-key',
      reason: `web/API cache clear requested for eval ${evalKey}`,
    });
    expect(mockRunner.clearCache).toHaveBeenCalledWith({
      namespace: 'manual-value-namespace',
      key: 'value-key',
      reason: `web/API cache clear requested for eval ${evalKey}`,
    });
  });

  test('rejects clear-by-runs without an exact eval key', async () => {
    const response = await app.request('/cache/actions/eval', {
      method: 'DELETE',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'evalKey query param is required',
    });
    expect(mockRunner.clearCache).not.toHaveBeenCalled();
  });

  test('clears cache entries recorded by a run and earlier runs', async () => {
    mockRunner.getRuns.mockReturnValue([
      { id: 'old-run' },
      { id: 'selected-run' },
      { id: 'new-run' },
    ]);
    mockRunner.getRun.mockImplementation((runId: string) => {
      if (runId === 'old-run') {
        return {
          manifest: {
            id: 'old-run',
            shortId: 'r1',
            startedAt: '2026-05-18T10:00:00.000Z',
          },
          cases: [{ caseId: 'old-run-case' }],
        };
      }
      if (runId === 'selected-run') {
        return {
          manifest: {
            id: 'selected-run',
            shortId: 'r2',
            startedAt: '2026-05-18T11:00:00.000Z',
          },
          cases: [{ caseId: 'selected-run-case' }],
        };
      }
      if (runId === 'new-run') {
        return {
          manifest: {
            id: 'new-run',
            shortId: 'r3',
            startedAt: '2026-05-18T12:00:00.000Z',
          },
          cases: [{ caseId: 'new-run-case' }],
        };
      }
      return undefined;
    });
    mockRunner.getCaseDetail.mockImplementation(
      (runId: string, caseId: string) => {
        if (runId === 'new-run') {
          return {
            cacheRefs: [],
            trace: [
              {
                id: 'ignored-new-span',
                name: caseId,
                attributes: {
                  'cache.status': 'hit',
                  'cache.namespace': 'new-run-namespace',
                  'cache.key': 'new-run-key',
                },
              },
            ],
          };
        }

        return {
          cacheRefs:
            runId === 'old-run'
              ? [
                  {
                    type: 'value',
                    name: 'old-value',
                    namespace: 'shared-namespace',
                    key: 'shared-key',
                    status: 'hit',
                  },
                ]
              : [],
          scoringTraces:
            runId === 'selected-run'
              ? {
                  quality: {
                    cacheRefs: [],
                    trace: [
                      {
                        id: 'score-span',
                        name: 'score-cache',
                        attributes: {
                          'cache.status': 'hit',
                          'cache.namespace': 'score-namespace',
                          'cache.key': 'score-key',
                        },
                      },
                    ],
                  },
                }
              : undefined,
          trace: [
            {
              id: `${runId}-span`,
              name: caseId,
              attributes: {
                'cache.status': 'miss',
                'cache.namespace':
                  runId === 'old-run'
                    ? 'shared-namespace'
                    : 'selected-namespace',
                'cache.key':
                  runId === 'old-run' ? 'shared-key' : 'selected-key',
              },
            },
          ],
        };
      },
    );

    const response = await app.request(
      '/cache/actions/run-history/selected-run',
      { method: 'DELETE' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deletedEntries: 3,
      entries: [
        { namespace: 'shared-namespace', key: 'shared-key' },
        { namespace: 'selected-namespace', key: 'selected-key' },
        { namespace: 'score-namespace', key: 'score-key' },
      ],
    });
    expect(mockRunner.clearCache).toHaveBeenCalledTimes(3);
    expect(mockRunner.clearCache).not.toHaveBeenCalledWith({
      namespace: 'new-run-namespace',
      key: 'new-run-key',
      reason:
        'web/API cache clear requested for run history through selected-run',
    });
  });

  test('rejects clear-by-run-history when the run is missing', async () => {
    mockRunner.getRun.mockReturnValue(undefined);

    const response = await app.request(
      '/cache/actions/run-history/missing-run',
      { method: 'DELETE' },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Run not found' });
    expect(mockRunner.clearCache).not.toHaveBeenCalled();
  });
});
