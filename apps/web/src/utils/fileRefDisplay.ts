import type { ColumnDef, ColumnFormat, FileRef } from '@agent-evals/shared';
import { apiUrl } from '#src/utils/apiUrl';

export function getEffectiveFileRefFormat(
  def: Pick<ColumnDef, 'format'>,
  ref: FileRef,
): ColumnFormat {
  if (def.format !== undefined) return def.format;
  return inferFileRefFormat(ref.mimeType);
}

export function isPreviewableFileRefFormat(format: ColumnFormat): boolean {
  return (
    format === 'image' ||
    format === 'html' ||
    format === 'pdf' ||
    format === 'audio' ||
    format === 'video'
  );
}

export function getFileUrl(ref: FileRef): string {
  if (ref.source === 'repo') {
    const params = new URLSearchParams({ path: ref.path });
    if (ref.mimeType) {
      params.set('mimeType', ref.mimeType);
    }
    return apiUrl(`/api/repo-file?${params.toString()}`);
  }
  const params = new URLSearchParams({ mimeType: ref.mimeType });
  if (ref.fileName) {
    params.set('fileName', ref.fileName);
  }
  return apiUrl(`/api/artifacts/${ref.artifactId}?${params.toString()}`);
}

export function getFileLabel(ref: FileRef): string {
  if (ref.source === 'repo') {
    return ref.path.split('/').at(-1) ?? ref.path;
  }
  return ref.fileName ?? ref.artifactId;
}

function inferFileRefFormat(mimeType: string | undefined): ColumnFormat {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'text/html' || normalized === 'application/xhtml+xml') {
    return 'html';
  }
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('video/')) return 'video';
  return 'file';
}

function normalizeMimeType(mimeType: string | undefined): string {
  return mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
}
