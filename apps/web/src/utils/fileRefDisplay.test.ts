import type { CellValue, ColumnDef, FileRef } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  getEffectiveFileRefFormat,
  isPreviewableFileRefFormat,
} from '#src/utils/fileRefDisplay';

const baseColumnDef: ColumnDef = {
  key: 'artifact',
  label: 'Artifact',
  kind: 'string',
};

function artifact(mimeType: string): FileRef {
  return {
    source: 'run',
    artifactId: 'run-id__case-id__t0__artifact__artifact.bin',
    mimeType,
    fileName: 'artifact.bin',
  };
}

function isFileRef(value: CellValue): value is FileRef {
  if (typeof value !== 'object' || value === null || !('source' in value)) {
    return false;
  }
  return value.source === 'repo' || value.source === 'run';
}

function isPreviewable(def: ColumnDef, value: CellValue): boolean {
  if (!isFileRef(value)) return false;
  return isPreviewableFileRefFormat(getEffectiveFileRefFormat(def, value));
}

describe('file ref display', () => {
  test('marks inferred preview file formats as previewable', () => {
    expect(isPreviewable(baseColumnDef, artifact('application/pdf'))).toBe(
      true,
    );
    expect(isPreviewable(baseColumnDef, artifact('image/png'))).toBe(true);
    expect(isPreviewable(baseColumnDef, artifact('audio/wav'))).toBe(true);
    expect(isPreviewable(baseColumnDef, artifact('video/mp4'))).toBe(true);
  });

  test('does not preview generic files or explicitly non-preview columns', () => {
    expect(
      isPreviewable(baseColumnDef, artifact('application/octet-stream')),
    ).toBe(false);
    expect(
      isPreviewable(
        { ...baseColumnDef, format: 'json' },
        artifact('application/pdf'),
      ),
    ).toBe(false);
  });
});
