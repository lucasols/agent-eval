import { expect, test } from 'vitest';
import {
  formatCaseDetailPath,
  formatRunFolderDisplayPath,
  formatRunFolderPath,
  getCaseArtifactFileId,
} from '#src/utils/runPaths';

test('formats run folder paths for POSIX, Windows, and unknown workspace roots', () => {
  expect(formatRunFolderPath('/repo/project/', 'run-1')).toBe(
    '/repo/project/.agent-evals/runs/run-1',
  );
  expect(formatRunFolderPath('C:\\repo\\project\\', 'run-1')).toBe(
    'C:\\repo\\project\\.agent-evals\\runs\\run-1',
  );
  expect(formatRunFolderPath('', 'run-1')).toBe('.agent-evals/runs/run-1');
  expect(formatRunFolderDisplayPath('run-1')).toBe(
    '<root>/.agent-evals/runs/run-1',
  );
});

test('formats encoded case detail paths', () => {
  expect(
    formatCaseDetailPath({
      runFolderPath: '/repo/project/.agent-evals/runs/run-1/',
      caseArtifactFileId: 'case/one',
    }),
  ).toBe('/repo/project/.agent-evals/runs/run-1/case-details/case%2Fone.json');
  expect(
    formatCaseDetailPath({
      runFolderPath: 'C:\\repo\\project\\.agent-evals\\runs\\run-1\\',
      caseArtifactFileId: 'case/one',
    }),
  ).toBe(
    'C:\\repo\\project\\.agent-evals\\runs\\run-1\\case-details\\case%2Fone.json',
  );
});

test('matches persisted artifact ids for duplicate case ids', () => {
  const caseRows = [
    {
      caseId: 'same-case',
      caseKey: 'evals/first.eval.ts#workflow#same-case',
      trial: 0,
    },
    {
      caseId: 'same-case',
      caseKey: 'evals/second.eval.ts#workflow#same-case',
      trial: 0,
    },
  ];
  const [firstCase, secondCase] = caseRows;
  if (firstCase === undefined || secondCase === undefined) {
    throw new Error('Expected duplicate case rows');
  }

  expect(getCaseArtifactFileId(caseRows, firstCase)).toBe('same-case');
  expect(getCaseArtifactFileId(caseRows, secondCase)).toBe(
    'evals/second.eval.ts#workflow#same-case',
  );
});
