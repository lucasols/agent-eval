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
          logs: artifacts.caseDetails['all-column-formats.json']?.logs.map(
            (entry) => ({
              level: entry.level,
              phase: entry.phase,
              message: entry.message,
              args: entry.args,
              truncated: entry.truncated,
            }),
          ),
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
                  "sizeBytes": 146,
                  "source": "run",
                },
                "audioBrief": {
                  "artifactId": "<run-id>__all-column-formats__t0__audioBrief__chime.wav",
                  "fileName": "chime.wav",
                  "mimeType": "audio/wav",
                  "sizeBytes": 1644,
                  "source": "run",
                },
                "automatedQuality": 0.8,
                "confidence": 0.93,
                "generatedAt": "<timestamp>",
                "handlingCostUsd": 1.25,
                "htmlReport": {
                  "artifactId": "<run-id>__all-column-formats__t0__htmlReport__refund-report.html",
                  "fileName": "refund-report.html",
                  "mimeType": "text/html",
                  "sizeBytes": 858,
                  "source": "run",
                },
                "inferredMarkdownSummary": "- Order \`A-1024\` is ready for review
        - Confirmation can be sent from the refund queue",
                "llmTurns": 0,
                "pdfReport": {
                  "artifactId": "<run-id>__all-column-formats__t0__pdfReport__refund-report.pdf",
                  "fileName": "refund-report.pdf",
                  "mimeType": "application/pdf",
                  "sizeBytes": 721,
                  "source": "run",
                },
                "plainTextSummary": "Order: A-1024
        Status: refund package ready
        Next step: send confirmation",
                "previewCard": {
                  "artifactId": "<run-id>__all-column-formats__t0__previewCard__previewCard.svg",
                  "fileName": "previewCard.svg",
                  "mimeType": "image/svg+xml",
                  "sizeBytes": 1151,
                  "source": "run",
                },
                "rawToolEvents": [
                  {
                    "name": "receipt-match",
                    "status": "passed",
                    "textWithLineBreaks": "Matched receipt
        Amount: $15.99",
                  },
                  {
                    "name": "queue-routing",
                    "status": "ready",
                  },
                ],
                "requestCount": 1200,
                "requiresManualReview": false,
                "response": "Prepared **refund package** for order \`A-1024\`.

        Customer note: Please confirm the refund package for my damaged mug.",
                "reviewQueuedAt": "<timestamp>",
                "reviewTimeMs": 1450,
                "reviewerDecision": null,
                "reviewerQuality": null,
                "toolCalls": 0,
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
          "logs": [
            {
              "args": [
                "Preparing format gallery package for %s",
                "A-1024",
              ],
              "level": "info",
              "message": "Preparing format gallery package for A-1024",
              "phase": "eval",
              "truncated": false,
            },
            {
              "args": [
                "Loaded refund package assets",
                {
                  "audioBytes": 1644,
                  "previewBytes": 1151,
                },
              ],
              "level": "info",
              "message": "Loaded refund package assets { previewBytes: 1151, audioBytes: 1644 }",
              "phase": "eval",
              "truncated": false,
            },
          ],
          "persistedArtifactFiles": [
            "<run-id>__all-column-formats__t0__attachment__refund-template.txt",
            "<run-id>__all-column-formats__t0__audioBrief__chime.wav",
            "<run-id>__all-column-formats__t0__htmlReport__refund-report.html",
            "<run-id>__all-column-formats__t0__pdfReport__refund-report.pdf",
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

      const htmlReportArtifactName = persistedArtifactFiles.find((fileName) =>
        fileName.includes('__htmlReport__'),
      );
      if (htmlReportArtifactName === undefined) {
        throw new Error('Expected HTML report artifact to be persisted');
      }

      const htmlReportArtifact = await readFile(
        resolve(
          workspacePath,
          '.agent-evals/runs',
          artifacts.manifest.id,
          'artifacts',
          htmlReportArtifactName,
        ),
        'utf8',
      );
      expect(htmlReportArtifact).toContain(
        '<title>Refund Package Report</title>',
      );

      const pdfReportArtifactName = persistedArtifactFiles.find((fileName) =>
        fileName.includes('__pdfReport__'),
      );
      if (pdfReportArtifactName === undefined) {
        throw new Error('Expected PDF report artifact to be persisted');
      }

      const pdfReportArtifact = await readFile(
        resolve(
          workspacePath,
          '.agent-evals/runs',
          artifacts.manifest.id,
          'artifacts',
          pdfReportArtifactName,
        ),
        'utf8',
      );
      expect(pdfReportArtifact).toContain('%PDF-1.4');
      expect(pdfReportArtifact).toContain('Refund Package Report');
    });
  });
});
