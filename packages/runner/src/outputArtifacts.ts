import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { RunArtifactRef } from '@agent-evals/shared';

const mimeTypeExtensionMap: Record<string, string> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/html': '.html',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

type PersistInlineArtifactParams = {
  artifactDir: string;
  runId: string;
  caseId: string;
  outputKey: string;
  trial: number;
  value: Blob;
};

/**
 * Persist a `Blob`/`File` emitted via `setOutput(...)` into the current run's
 * artifact directory and return the resulting run artifact reference.
 */
export async function persistInlineArtifact({
  artifactDir,
  runId,
  caseId,
  outputKey,
  trial,
  value,
}: PersistInlineArtifactParams): Promise<RunArtifactRef> {
  await mkdir(artifactDir, { recursive: true });

  const mimeType = normalizeMimeType(value.type);
  const fileName = getArtifactFileName({ outputKey, mimeType, value });
  const artifactId = [
    sanitizeSegment(runId),
    sanitizeSegment(caseId),
    `t${String(trial)}`,
    sanitizeSegment(outputKey),
    sanitizeFileName(fileName),
  ].join('__');

  const targetPath = join(artifactDir, artifactId);
  const bytes = new Uint8Array(await value.arrayBuffer());
  await writeFile(targetPath, bytes);

  return { source: 'run', artifactId, mimeType, fileName };
}

/** Resolve a persisted run artifact path from its artifact id. */
export function resolveArtifactPath(
  runsDir: string,
  artifactId: string,
): string | undefined {
  const [runId] = artifactId.split('__', 1);
  if (!runId) return undefined;
  return join(runsDir, runId, 'artifacts', artifactId);
}

function normalizeMimeType(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : 'application/octet-stream';
}

function getArtifactFileName(params: {
  outputKey: string;
  mimeType: string;
  value: Blob;
}): string {
  const { outputKey, mimeType, value } = params;
  if (isFile(value) && value.name.trim().length > 0) {
    return value.name.trim();
  }

  const extension = getExtensionForMimeType(mimeType);
  return extension.length > 0
    ? `${sanitizeSegment(outputKey)}${extension}`
    : sanitizeSegment(outputKey);
}

function getExtensionForMimeType(mimeType: string): string {
  const exactMatch = mimeTypeExtensionMap[mimeType];
  if (exactMatch) return exactMatch;

  const subtype = mimeType.split('/')[1];
  if (subtype === undefined || subtype.length === 0) return '';
  const withoutSuffix = subtype.split('+')[0] ?? subtype;
  return withoutSuffix.length > 0 ? `.${withoutSuffix}` : '';
}

function sanitizeSegment(value: string): string {
  const normalized = value.trim().replaceAll(/[^A-Za-z0-9._-]+/g, '-');
  return normalized.length > 0 ? normalized : 'artifact';
}

function sanitizeFileName(value: string): string {
  const normalized = sanitizeSegment(value);
  const extension = extname(normalized);
  if (extension.length === 0) return normalized;
  const stem = normalized.slice(0, -extension.length);
  return `${stem.replaceAll('.', '-')}${extension}`;
}

function isFile(value: Blob): value is File {
  return value instanceof File;
}
