import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { ManualInputFileValue } from '@agent-evals/sdk';
import { resultify } from 't-result';

const stagedUploadDir = '.agent-evals/manual-input-uploads';

const mimeTypeByExtension: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
};

type StageManualInputFileParams = {
  workspaceRoot: string;
  bytes: Uint8Array;
  name: string;
  mimeType?: string | undefined;
};

type StageManualInputFileFromPathParams = {
  workspaceRoot: string;
  path: string;
  name?: string | undefined;
  mimeType?: string | undefined;
};

type MaterializeManualInputFilesParams = {
  workspaceRoot: string;
  runId: string;
  runDir: string;
  value: unknown;
};

export type MaterializeManualInputFilesResult =
  | { error: null; value: unknown }
  | { error: string; value: null };

function toWorkspaceRelativePath(params: {
  workspaceRoot: string;
  filePath: string;
}): string {
  return relative(params.workspaceRoot, params.filePath).replaceAll('\\', '/');
}

function isInsideWorkspace(params: {
  workspaceRoot: string;
  filePath: string;
}): boolean {
  const rel = relative(params.workspaceRoot, params.filePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function sanitizeSegment(value: string): string {
  const normalized = value.trim().replaceAll(/[^A-Za-z0-9._-]+/g, '-');
  return normalized.length > 0 ? normalized : 'file';
}

function sanitizeFileName(value: string): string {
  const normalized = sanitizeSegment(value);
  const extension = extname(normalized);
  if (extension.length === 0) return normalized;
  const stem = normalized.slice(0, -extension.length);
  return `${stem.replaceAll('.', '-')}${extension}`;
}

function inferMimeType(params: {
  mimeType?: string | undefined;
  name: string;
}): string {
  const normalized = params.mimeType?.trim();
  if (normalized && normalized.length > 0) return normalized;
  return mimeTypeByExtension[extname(params.name).toLowerCase()] ?? '';
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isManualInputFileValue(
  value: unknown,
): value is ManualInputFileValue {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.sha256 === 'string' &&
    typeof value.path === 'string'
  );
}

function isStagedManualInputPath(path: string): boolean {
  return (
    path === stagedUploadDir ||
    path.startsWith(`${stagedUploadDir}/`) ||
    path.startsWith(stagedUploadDir + sep)
  );
}

/**
 * Persist uploaded manual-input bytes in the workspace staging area and return
 * the JSON-safe metadata used by manual-input schemas.
 */
export async function stageManualInputFile({
  workspaceRoot,
  bytes,
  name,
  mimeType,
}: StageManualInputFileParams): Promise<ManualInputFileValue> {
  const fileName = sanitizeFileName(name || 'uploaded-file');
  const sha256 = hashBytes(bytes);
  const dir = resolve(workspaceRoot, stagedUploadDir);
  await mkdir(dir, { recursive: true });
  const targetPath = join(
    dir,
    `${Date.now().toString(36)}-${randomUUID()}__${sha256.slice(0, 12)}__${fileName}`,
  );
  await writeFile(targetPath, bytes);
  return {
    name: name || fileName,
    mimeType: inferMimeType({ mimeType, name: fileName }),
    sizeBytes: bytes.byteLength,
    sha256,
    path: toWorkspaceRelativePath({ workspaceRoot, filePath: targetPath }),
  };
}

/**
 * Read a file path supplied by the CLI and stage it as a manual-input file.
 */
export async function stageManualInputFileFromPath({
  workspaceRoot,
  path,
  name,
  mimeType,
}: StageManualInputFileFromPathParams): Promise<ManualInputFileValue> {
  const sourcePath = isAbsolute(path)
    ? resolve(path)
    : resolve(workspaceRoot, path);
  const bytes = new Uint8Array(await readFile(sourcePath));
  return await stageManualInputFile({
    workspaceRoot,
    bytes,
    name: name ?? basename(sourcePath),
    mimeType: inferMimeType({ mimeType, name: name ?? basename(sourcePath) }),
  });
}

async function materializeOneManualInputFile(params: {
  workspaceRoot: string;
  runId: string;
  runDir: string;
  value: ManualInputFileValue;
}): Promise<ManualInputFileValue> {
  const sourcePath = resolve(params.workspaceRoot, params.value.path);
  if (
    !isInsideWorkspace({
      workspaceRoot: params.workspaceRoot,
      filePath: sourcePath,
    })
  ) {
    throw new Error(
      `Manual input file path escapes workspace: ${params.value.path}`,
    );
  }

  const bytes = new Uint8Array(await readFile(sourcePath));
  const sha256 = hashBytes(bytes);
  const fileName = sanitizeFileName(params.value.name || basename(sourcePath));
  const artifactId = [
    sanitizeSegment(params.runId),
    'manual-input',
    sha256.slice(0, 12),
    fileName,
  ].join('__');
  const targetPath = join(params.runDir, 'artifacts', artifactId);
  await mkdir(join(params.runDir, 'artifacts'), { recursive: true });
  if (sourcePath !== targetPath) {
    await copyFile(sourcePath, targetPath);
  }

  if (isStagedManualInputPath(params.value.path)) {
    await resultify(() => rm(sourcePath, { force: true }));
  }

  return {
    name: params.value.name,
    mimeType: inferMimeType({
      mimeType: params.value.mimeType,
      name: params.value.name || fileName,
    }),
    sizeBytes: bytes.byteLength,
    sha256,
    path: toWorkspaceRelativePath({
      workspaceRoot: params.workspaceRoot,
      filePath: targetPath,
    }),
  };
}

async function materializeUnknownValue(params: {
  workspaceRoot: string;
  runId: string;
  runDir: string;
  value: unknown;
}): Promise<unknown> {
  if (isManualInputFileValue(params.value)) {
    return await materializeOneManualInputFile({
      workspaceRoot: params.workspaceRoot,
      runId: params.runId,
      runDir: params.runDir,
      value: params.value,
    });
  }
  if (Array.isArray(params.value)) {
    return await Promise.all(
      params.value.map(
        async (entry) =>
          await materializeUnknownValue({
            workspaceRoot: params.workspaceRoot,
            runId: params.runId,
            runDir: params.runDir,
            value: entry,
          }),
      ),
    );
  }
  if (isRecord(params.value)) {
    const entries = await Promise.all(
      Object.entries(params.value).map(async ([key, child]) => {
        const nextValue = await materializeUnknownValue({
          workspaceRoot: params.workspaceRoot,
          runId: params.runId,
          runDir: params.runDir,
          value: child,
        });
        return [key, nextValue] as const;
      }),
    );
    return Object.fromEntries(entries);
  }
  return params.value;
}

/**
 * Copy all manual-input file references inside a run request into the run's
 * artifact directory and return a request-safe value with artifact paths.
 */
export async function materializeManualInputFiles({
  workspaceRoot,
  runId,
  runDir,
  value,
}: MaterializeManualInputFilesParams): Promise<MaterializeManualInputFilesResult> {
  const result = await resultify(() =>
    materializeUnknownValue({ workspaceRoot, runId, runDir, value }),
  );
  if (result.error) {
    return { error: result.error.message, value: null };
  }
  return { error: null, value: result.value };
}

/** Remove stale staged manual-input uploads from previous abandoned runs. */
export async function cleanupStagedManualInputFiles(
  workspaceRoot: string,
): Promise<void> {
  await resultify(() =>
    rm(resolve(workspaceRoot, stagedUploadDir), {
      force: true,
      recursive: true,
    }),
  );
}
