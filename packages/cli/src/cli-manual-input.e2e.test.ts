import { writeFile } from 'node:fs/promises';
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
