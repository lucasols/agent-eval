import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI output formats', () => {
  test('supports multiple column formats from plain output values', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'format-gallery',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const persistedArtifactFiles = (
        await readdir(
          resolve(
            workspacePath,
            '.agent-evals/runs',
            artifacts.manifest.id,
            'artifacts',
          ),
        )
      ).sort();

      expect(
        normalizeSnapshotValue(workspacePath, {
          caseRows: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            columns: caseRow.columns,
            status: caseRow.status,
          })),
          persistedArtifactFiles,
        }),
      ).toMatchInlineSnapshot(`
{
  "caseRows": [
    {
      "caseId": "all-column-formats",
      "columns": {
        "attachment": {
          "artifactId": "<run-id>__all-column-formats__t0__attachment__refund-template.txt",
          "fileName": "refund-template.txt",
          "mimeType": "text/plain",
          "source": "run",
        },
        "audioBrief": {
          "artifactId": "<run-id>__all-column-formats__t0__audioBrief__chime.wav",
          "fileName": "chime.wav",
          "mimeType": "audio/wav",
          "source": "run",
        },
        "automatedQuality": 0.8,
        "confidence": 0.93,
        "handlingCostUsd": 1.25,
        "previewCard": {
          "artifactId": "<run-id>__all-column-formats__t0__previewCard__previewCard.svg",
          "fileName": "previewCard.svg",
          "mimeType": "image/svg+xml",
          "source": "run",
        },
        "requestCount": 1200,
        "requiresManualReview": false,
        "response": "Prepared **refund package** for order \`A-1024\`.\n\nCustomer note: Please confirm the refund package for my damaged mug.",
        "reviewTimeMs": 1450,
        "reviewerDecision": null,
        "reviewerQuality": null,
        "toolResult": {
          "matchedReceipt": true,
          "nextStep": "send-refund-confirmation",
          "orderId": "A-1024",
          "reviewer": {
            "name": "Avery",
            "queue": "refund-ops",
          },
        },
      },
      "status": "pass",
    },
  ],
  "persistedArtifactFiles": [
    "<run-id>__all-column-formats__t0__attachment__refund-template.txt",
    "<run-id>__all-column-formats__t0__audioBrief__chime.wav",
    "<run-id>__all-column-formats__t0__previewCard__previewCard.svg",
  ],
}
      `);

      const previewCardArtifactName = persistedArtifactFiles.find((fileName) =>
        fileName.includes('__previewCard__'),
      );
      if (previewCardArtifactName === undefined) {
        throw new Error('Expected preview card artifact to be persisted');
      }

      const previewCardArtifact = await readFile(
        resolve(
          workspacePath,
          '.agent-evals/runs',
          artifacts.manifest.id,
          'artifacts',
          previewCardArtifactName,
        ),
        'utf8',
      );
      expect(previewCardArtifact).toContain('Refund Review');
    });
  });
});
