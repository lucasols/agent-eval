import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { manualInputFilesRoutes } from './manualInputFiles.ts';
import { runsRoutes } from './runs.ts';

const mockRunner = vi.hoisted(() => ({
  getConfigReloadState: vi.fn(),
  validateManualInputs: vi.fn(),
  startRun: vi.fn(),
  getWorkspaceRoot: vi.fn(),
}));

vi.mock('../runner.ts', () => ({ getRunnerInstance: () => mockRunner }));

const app = new Hono().route('/runs', runsRoutes);
const uploadApp = new Hono().route(
  '/manual-input-files',
  manualInputFilesRoutes,
);

beforeEach(() => {
  mockRunner.getWorkspaceRoot.mockReturnValue(process.cwd());
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

describe('manual input file upload route', () => {
  test('stages uploaded files as workspace-relative manual input values', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'agent-evals-upload-'));
    onTestFinished(async () => {
      await rm(workspacePath, { force: true, recursive: true });
    });
    mockRunner.getWorkspaceRoot.mockReturnValue(workspacePath);
    const form = new FormData();
    form.set(
      'file',
      new Blob([new Uint8Array([1, 2, 3])], {
        type: 'application/octet-stream',
      }),
      'sample.bin',
    );

    const response = await uploadApp.request('/manual-input-files', {
      method: 'POST',
      body: form,
    });

    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(body).not.toHaveProperty('dataUrl');
    if (typeof body !== 'object' || body === null || !('path' in body)) {
      throw new Error('Expected upload response to include path');
    }
    expect(body).toMatchObject({
      name: 'sample.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: 3,
    });
    const path = body.path;
    if (typeof path !== 'string') {
      throw new Error('Expected upload path to be a string');
    }
    expect(path).toContain('.agent-evals/manual-input-uploads/');
    await expect(readFile(join(workspacePath, path))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
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
