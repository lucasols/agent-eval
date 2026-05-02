import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManualInputFile } from '@agent-evals/sdk';
import { expect, onTestFinished, test } from 'vitest';
import {
  isManualInputFileValue,
  materializeManualInputFiles,
  stageManualInputFileFromPath,
} from './files.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function makeWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-evals-files-'));
  onTestFinished(async () => {
    await rm(workspacePath, { force: true, recursive: true });
  });
  return workspacePath;
}

test('materializes staged manual input files into run artifacts', async () => {
  const workspacePath = await makeWorkspace();
  const sourcePath = join(workspacePath, 'payload.json');
  await writeFile(sourcePath, JSON.stringify({ ok: true }));

  const staged = await stageManualInputFileFromPath({
    workspaceRoot: workspacePath,
    path: './payload.json',
  });
  expect(staged.path).toContain('.agent-evals/manual-input-uploads/');

  const runDir = join(workspacePath, '.agent-evals/runs/run-id');
  await mkdir(join(runDir, 'artifacts'), { recursive: true });
  const result = await materializeManualInputFiles({
    workspaceRoot: workspacePath,
    runId: 'run-id',
    runDir,
    value: { image: staged },
  });

  expect(result.error).toBeNull();
  if (result.value === null || !isRecord(result.value)) {
    throw new Error('Expected materialized value object');
  }
  const image = result.value.image;
  if (!isManualInputFileValue(image)) {
    throw new Error('Expected materialized image file value');
  }
  expect(image).toMatchObject({
    name: 'payload.json',
    mimeType: 'application/json',
    sizeBytes: 11,
  });
  expect(image.path).toContain('.agent-evals/runs/run-id/artifacts/');
  expect(image).not.toHaveProperty('dataUrl');

  const read = await readManualInputFile(image, { cwd: workspacePath });
  expect(read.bytes).toEqual(new Uint8Array(await readFile(sourcePath)));
  expect(read.arrayBuffer.byteLength).toBe(11);
  expect(read.blob.type).toBe('application/json');
  expect(read.file.name).toBe('payload.json');
  await expect(read.text()).resolves.toBe('{"ok":true}');
  await expect(read.json()).resolves.toEqual({ ok: true });
});

test('readManualInputFile rejects missing files', async () => {
  const workspacePath = await makeWorkspace();
  await expect(
    readManualInputFile(
      {
        name: 'missing.txt',
        mimeType: 'text/plain',
        path: '.agent-evals/runs/run-id/artifacts/missing.txt',
        sha256: '0'.repeat(64),
        sizeBytes: 1,
      },
      { cwd: workspacePath },
    ),
  ).rejects.toThrow();
});
