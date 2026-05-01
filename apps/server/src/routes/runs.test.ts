import { Hono } from 'hono';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { runsRoutes } from './runs.ts';

const mockRunner = vi.hoisted(() => ({
  getConfigReloadState: vi.fn(),
  validateManualInputs: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock('../runner.ts', () => ({ getRunnerInstance: () => mockRunner }));

const app = new Hono().route('/runs', runsRoutes);

beforeEach(() => {
  mockRunner.getConfigReloadState.mockReturnValue({
    status: 'idle',
    activeRunCount: 0,
    lastChangedAt: null,
    lastReloadedAt: null,
  });
  mockRunner.validateManualInputs.mockReturnValue({ ok: true });
  mockRunner.startRun.mockResolvedValue({
    manifest: {
      id: 'run-1',
      shortId: 'r0',
      status: 'running',
      startedAt: '2026-05-01T00:00:00.000Z',
      endedAt: null,
      commitSha: null,
      evalSourceFingerprints: {},
      target: { mode: 'all' },
      trials: 1,
      trialSelection: 'lowestScore',
      cacheMode: 'use',
    },
    summary: {
      runId: 'run-1',
      status: 'running',
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
      errorCases: 0,
      cancelledCases: 0,
      totalDurationMs: null,
      errorMessage: null,
    },
    cases: [],
  });
});

describe('runs route config reload guard', () => {
  test('blocks run creation while config reload is pending', async () => {
    mockRunner.getConfigReloadState.mockReturnValue({
      status: 'pending',
      activeRunCount: 1,
      lastChangedAt: '2026-05-01T00:00:00.000Z',
      lastReloadedAt: null,
    });

    const response = await app.request('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: { mode: 'all' }, trials: 1 }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONFIG_RELOAD_PENDING',
      configReload: { status: 'pending', activeRunCount: 1 },
    });
    expect(mockRunner.validateManualInputs).not.toHaveBeenCalled();
    expect(mockRunner.startRun).not.toHaveBeenCalled();
  });
});
