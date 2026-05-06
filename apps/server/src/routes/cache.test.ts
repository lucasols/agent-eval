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
    });
    expect(mockRunner.clearCache).toHaveBeenCalledWith({
      namespace: 'manual-value-namespace',
      key: 'value-key',
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
});
