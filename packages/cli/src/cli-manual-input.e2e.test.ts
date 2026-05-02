import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI manualInput', () => {
  test('runs a manual-input eval when --input supplies valid JSON', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'manual-input-greeting',
        '--input',
        JSON.stringify({
          name: 'Ada',
          tone: 'friendly',
          notes: 'First-time customer',
          sendEmail: true,
          locale: 'en',
        }),
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      expect(
        normalizeSnapshotValue(workspacePath, {
          caseRows: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            columns: caseRow.columns,
            status: caseRow.status,
          })),
          input: Object.values(artifacts.caseDetails)[0]?.input,
          summary: artifacts.summary,
        }),
      ).toMatchInlineSnapshot(`
        {
          "caseRows": [
            {
              "caseId": "manual-input-greeting-manual",
              "columns": {
                "channelHint": "Will follow up via email in English.",
                "greeting": "Hi, Ada! Note: First-time customer",
                "llmTurns": 0,
                "notesIncluded": true,
                "toolCalls": 0,
              },
              "status": "pass",
            },
          ],
          "input": {
            "locale": "en",
            "name": "Ada",
            "notes": "First-time customer",
            "sendEmail": true,
            "tone": "friendly",
          },
          "summary": {
            "cancelledCases": 0,
            "errorCases": 0,
            "errorMessage": null,
            "failedCases": 0,
            "passedCases": 1,
            "runId": "<run-id>",
            "status": "completed",
            "totalCases": 1,
            "totalDurationMs": "<totalDurationMs>",
          },
        }
      `);
    });
  });

  test('errors before kicking off a run when --input is missing', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'manual-input-greeting',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatchInlineSnapshot(
        `"Eval(s) require manual input but no --input/--input-file was provided: manual-input-greeting"`,
      );
    });
  });

  test('reports schema validation failures with field paths', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'manual-input-greeting',
        '--input',
        JSON.stringify({ name: '', tone: 'friendly', locale: 'en' }),
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Status: error');
      expect(result.stdout).toContain(
        'Invalid manual input for eval "manual-input-greeting": name:',
      );
    });
  });

  test('runs the image-analyzer eval with a file value supplied via --input', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const tinyPngPath = join(workspacePath, 'tiny.png');
      await writeFile(
        tinyPngPath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64',
        ),
      );
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'manual-input-image-analyzer',
        '--input',
        JSON.stringify({
          image: { path: './tiny.png' },
          caption: 'a single pixel',
        }),
      ]);

      expect(result.exitCode).toBe(0);
      const artifacts = await readSingleRunArtifacts(workspacePath);
      expect(
        normalizeSnapshotValue(workspacePath, {
          artifactFiles: artifacts.artifactFiles,
          columns: artifacts.cases[0]?.columns,
          input: Object.values(artifacts.caseDetails)[0]?.input,
          status: artifacts.cases[0]?.status,
        }),
      ).toMatchInlineSnapshot(`
        {
          "artifactFiles": [
            "<run-id>__manual-input__63ef318d96b5__tiny.png",
          ],
          "columns": {
            "byteHead": "89 50 4e 47 0d 0a 1a 0a",
            "fileName": "tiny.png",
            "isImage": true,
            "llmTurns": 0,
            "mimeType": "image/png",
            "reply": "Got "tiny.png" (image/png, 68 bytes) — caption: "a single pixel".",
            "sizeBytes": 68,
            "toolCalls": 0,
          },
          "input": {
            "caption": "a single pixel",
            "image": {
              "mimeType": "image/png",
              "name": "tiny.png",
              "path": ".agent-evals/runs/<run-id>/artifacts/<run-id>__manual-input__63ef318d96b5__tiny.png",
              "sha256": "63ef318d96b5d0d0ceba6e04a4e622b1158335cdc67c49e27839132c6f655058",
              "sizeBytes": 68,
            },
          },
          "status": "pass",
        }
      `);
      const [artifactFile] = artifacts.artifactFiles;
      expect(artifactFile).toBeDefined();
      if (artifactFile === undefined) return;
      await expect(
        readFile(
          join(
            workspacePath,
            '.agent-evals',
            'runs',
            artifacts.manifest.id,
            'artifacts',
            artifactFile,
          ),
        ),
      ).resolves.toHaveLength(68);
    });
  });

  test('reads --input-file as a JSON map keyed by eval id or eval key', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const inputFilePath = join(workspacePath, 'manual-input.json');
      await writeFile(
        inputFilePath,
        JSON.stringify({
          'manual-input-greeting': {
            name: 'Grace',
            tone: 'formal',
            notes: '',
            sendEmail: false,
            locale: 'es',
          },
        }),
      );

      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'manual-input-greeting',
        '--input-file',
        inputFilePath,
      ]);

      expect(result.exitCode).toBe(0);
      const artifacts = await readSingleRunArtifacts(workspacePath);
      expect(
        normalizeSnapshotValue(workspacePath, {
          columns: artifacts.cases[0]?.columns,
          status: artifacts.cases[0]?.status,
        }),
      ).toMatchInlineSnapshot(`
        {
          "columns": {
            "channelHint": "Reply will be shown on screen in Spanish.",
            "greeting": "Greetings, Grace!",
            "llmTurns": 0,
            "notesIncluded": false,
            "toolCalls": 0,
          },
          "status": "pass",
        }
      `);
    });
  });
});
