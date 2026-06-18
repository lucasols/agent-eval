import type { ColumnDef, FileRef } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import { getEffectiveFileRefFormat } from '#src/utils/fileRefDisplay';

const baseColumnDef: ColumnDef = {
  key: 'artifact',
  label: 'Artifact',
  kind: 'string',
};

function runArtifact(mimeType: string): FileRef {
  return {
    source: 'run',
    artifactId: 'run-id__case-id__t0__artifact__artifact.bin',
    mimeType,
    fileName: 'artifact.bin',
  };
}

describe('getEffectiveFileRefFormat', () => {
  test('infers preview formats from artifact MIME types when metadata is missing', () => {
    expect(
      getEffectiveFileRefFormat(baseColumnDef, runArtifact('application/pdf')),
    ).toBe('pdf');
    expect(
      getEffectiveFileRefFormat(baseColumnDef, runArtifact('text/html')),
    ).toBe('html');
    expect(
      getEffectiveFileRefFormat(baseColumnDef, runArtifact('image/png')),
    ).toBe('image');
    expect(
      getEffectiveFileRefFormat(baseColumnDef, runArtifact('audio/wav')),
    ).toBe('audio');
    expect(
      getEffectiveFileRefFormat(baseColumnDef, runArtifact('video/mp4')),
    ).toBe('video');
  });

  test('keeps explicit column formats ahead of MIME inference', () => {
    expect(
      getEffectiveFileRefFormat(
        { ...baseColumnDef, format: 'json' },
        runArtifact('application/pdf'),
      ),
    ).toBe('json');
  });

  test('falls back to a download card for unknown file types', () => {
    expect(
      getEffectiveFileRefFormat(
        baseColumnDef,
        runArtifact('application/octet-stream'),
      ),
    ).toBe('file');
  });
});
