import type { CaseRow, ColumnDef } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  mergeRunRuntimeColumnDefs,
  mergeRuntimeColumnDefs,
} from '#src/utils/runtimeColumnDefs';

const baseCaseRow: CaseRow = {
  caseId: 'case-1',
  evalId: 'eval-1',
  status: 'pass',
  durationMs: 100,
  columns: {},
  trial: 0,
};

describe('runtime column definitions', () => {
  test('infers file formats from run artifact MIME types', () => {
    const defs = mergeRuntimeColumnDefs(
      [],
      {
        finalPdf: {
          source: 'run',
          artifactId: 'run-id__case-id__t0__finalPdf__finalPdf.pdf',
          mimeType: 'application/pdf',
          fileName: 'finalPdf.pdf',
        },
      },
      [],
    );

    expect(defs).toContainEqual({
      key: 'finalPdf',
      label: 'Final pdf',
      kind: 'string',
      format: 'pdf',
    });
  });

  test('keeps configured column formats over inferred runtime formats', () => {
    const configuredDefs: ColumnDef[] = [
      { key: 'finalPdf', label: 'Final PDF', kind: 'string', format: 'json' },
    ];

    expect(
      mergeRunRuntimeColumnDefs(configuredDefs, [
        {
          cases: [
            {
              ...baseCaseRow,
              columns: {
                finalPdf: {
                  source: 'run',
                  artifactId: 'run-id__case-id__t0__finalPdf__finalPdf.pdf',
                  mimeType: 'application/pdf',
                  fileName: 'finalPdf.pdf',
                },
              },
            },
          ],
        },
      ]),
    ).toEqual(configuredDefs);
  });
});
