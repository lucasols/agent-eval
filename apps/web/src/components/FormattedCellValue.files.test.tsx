import type { CellValue, ColumnDef, FileRef } from '@agent-evals/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  FormattedCellValue,
  getMediaPreviewItemsForColumns,
  summarizeCellValue,
} from '#src/components/FormattedCellValue';

const def: ColumnDef = { key: 'files', label: 'Files', kind: 'string' };
const image: FileRef = {
  source: 'repo',
  path: 'preview.png',
  mimeType: 'image/png',
};
const pdf: FileRef = {
  source: 'run',
  artifactId: 'report',
  fileName: 'report.pdf',
  mimeType: 'application/pdf',
};
const attachment: FileRef = {
  source: 'run',
  artifactId: 'notes',
  fileName: 'notes.txt',
  mimeType: 'text/plain',
};

describe('file array outputs', () => {
  test('renders an image, PDF preview, and download in array order', () => {
    const html = renderToStaticMarkup(
      <FormattedCellValue
        def={def}
        value={[image, pdf, attachment]}
      />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('report.pdf');
    expect(html).toContain('notes.txt');
    expect(html).toContain('fileName=notes.txt" download=""');
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('report.pdf'));
    expect(html.indexOf('report.pdf')).toBeLessThan(html.indexOf('notes.txt'));
  });

  test('includes each previewable array item with a unique navigation id', () => {
    const items = getMediaPreviewItemsForColumns([def], {
      files: [image, pdf, image, attachment],
    });
    expect(
      items.map((item) => ({
        id: item.id,
        format: item.format,
        fileName: item.fileName,
      })),
    ).toEqual([
      {
        id: 'files:repo:preview.png:0',
        format: 'image',
        fileName: 'preview.png',
      },
      { id: 'files:run:report:1', format: 'pdf', fileName: 'report.pdf' },
      {
        id: 'files:repo:preview.png:2',
        format: 'image',
        fileName: 'preview.png',
      },
    ]);
    expect(summarizeCellValue(def, [image, pdf])).toBe('2 files');
  });

  test('honors explicit download and JSON overrides', () => {
    const files = [image, pdf];
    for (const format of ['file', 'json'] as const) {
      expect(
        getMediaPreviewItemsForColumns([{ ...def, format }], { files }),
      ).toEqual([]);
    }
    const html = renderToStaticMarkup(
      <FormattedCellValue
        def={{ ...def, format: 'file' }}
        value={files}
      />,
    );
    expect(html).not.toContain('<img');
    expect(html.match(/download=""/g)).toHaveLength(2);
    expect(html).toContain('File download - preview.png');
    expect(html).toContain('File download - report.pdf');
  });

  test('leaves empty, mixed, and ordinary arrays as JSON', () => {
    const values: CellValue[] = [[], [image, 'text'], [{ source: 'run' }]];
    for (const value of values) {
      expect(getMediaPreviewItemsForColumns([def], { files: value })).toEqual(
        [],
      );
      expect(summarizeCellValue(def, value)).toBe('JSON');
    }
  });
});
