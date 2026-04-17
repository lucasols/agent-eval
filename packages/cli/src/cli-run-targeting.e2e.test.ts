import { describe, expect, test } from 'vitest';
import { runSummarySchema } from '@agent-evals/shared';
import {
  normalizeSnapshotValue,
  normalizeTextSnapshot,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI run targeting', () => {
  test('supports eval filters, comma-separated case filters, and no-cache mode', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text,with-image',
        '--no-cache',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Cache: disabled');
      expect(result.stdout).toContain('Total: 2');

      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(artifacts.manifest.target.mode).toBe('caseIds');
      expect(artifacts.manifest.target.evalIds).toEqual(['refund-workflow']);
      expect(artifacts.manifest.target.caseIds).toEqual([
        'simple-text',
        'with-image',
      ]);
      expect(artifacts.traceFiles).toEqual([
        'simple-text.json',
        'with-image.json',
      ]);
      expect(artifacts.cases.map((caseRow) => caseRow.caseId)).toEqual([
        'simple-text',
        'with-image',
      ]);

      expect(
        normalizeSnapshotValue(workspacePath, {
          commandOutput: normalizeTextSnapshot(workspacePath, result.stdout),
          persistedCases: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            response: caseRow.columns.response,
            score: caseRow.score,
            status: caseRow.status,
            toolCalls: caseRow.columns.toolCalls,
          })),
          target: artifacts.manifest.target,
        }),
      ).toMatchInlineSnapshot(`
        {
          "commandOutput": "Run started: <run-id>
        Cache: disabled
        Trials: 1

        --- Run Summary ---
        Status: completed
        Total: 2
        Passed: 2
        Failed: 0
        Errors: 0
        Avg Score: 1.00
        Duration: <duration>
        Cost: $0.0017",
          "persistedCases": [
            {
              "caseId": "simple-text",
              "response": [
                {
                  "kind": "markdown",
                  "text": "Approved refund for: I want a refund for order #123",
                },
              ],
              "score": 1,
              "status": "pass",
              "toolCalls": 1,
            },
            {
              "caseId": "with-image",
              "response": [
                {
                  "kind": "markdown",
                  "text": "Approved refund for: Please refund this damaged item",
                },
              ],
              "score": 1,
              "status": "pass",
              "toolCalls": 2,
            },
          ],
          "target": {
            "caseIds": [
              "simple-text",
              "with-image",
            ],
            "evalIds": [
              "refund-workflow",
            ],
            "mode": "caseIds",
          },
        }
      `);
    });
  });

  test('runs evals discovered inside nested folders', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'high-value-refund',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Total: 1');

      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(artifacts.manifest.target.mode).toBe('evalIds');
      expect(artifacts.manifest.target.evalIds).toEqual(['high-value-refund']);
      expect(artifacts.traceFiles).toEqual(['espresso-machine.json']);
      expect(artifacts.cases.map((caseRow) => caseRow.caseId)).toEqual([
        'espresso-machine',
      ]);

      expect(
        normalizeSnapshotValue(workspacePath, {
          commandOutput: normalizeTextSnapshot(workspacePath, result.stdout),
          persistedCases: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            evalId: caseRow.evalId,
            response: caseRow.columns.response,
            score: caseRow.score,
            status: caseRow.status,
            toolCalls: caseRow.columns.toolCalls,
          })),
          target: artifacts.manifest.target,
        }),
      ).toMatchInlineSnapshot(`
        {
          "commandOutput": "Run started: <run-id>
        Trials: 1

        --- Run Summary ---
        Status: completed
        Total: 1
        Passed: 1
        Failed: 0
        Errors: 0
        Avg Score: 1.00
        Duration: <duration>
        Cost: $0.0009",
          "persistedCases": [
            {
              "caseId": "espresso-machine",
              "evalId": "high-value-refund",
              "response": [
                {
                  "kind": "markdown",
                  "text": "Approved refund for: Refund the damaged espresso machine from order #9001",
                },
              ],
              "score": 1,
              "status": "pass",
              "toolCalls": 2,
            },
          ],
          "target": {
            "evalIds": [
              "high-value-refund",
            ],
            "mode": "evalIds",
          },
        }
      `);
    });
  });

  test('supports json summaries and persists one case row per trial', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
        '--trials',
        '2',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const summary = runSummarySchema.parse(JSON.parse(result.stdout));
      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(summary.status).toBe('completed');
      expect(summary.totalCases).toBe(2);
      expect(summary.passedCases).toBe(2);
      expect(artifacts.cases).toHaveLength(2);
      expect(artifacts.cases.map((caseRow) => caseRow.trial)).toEqual([0, 1]);
      expect(
        artifacts.cases.map((caseRow) => caseRow.caseId),
      ).toEqual(['simple-text', 'simple-text']);

      expect(
        normalizeSnapshotValue(workspacePath, {
          jsonSummary: summary,
          persistedCases: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            response: caseRow.columns.response,
            score: caseRow.score,
            trial: caseRow.trial,
          })),
        }),
      ).toMatchInlineSnapshot(`
        {
          "jsonSummary": {
            "averageScore": 1,
            "cancelledCases": 0,
            "cost": {
              "savingsUsd": null,
              "totalUsd": 0.0017499999999999998,
              "uncachedUsd": null,
            },
            "errorCases": 0,
            "errorMessage": null,
            "failedCases": 0,
            "passedCases": 2,
            "runId": "<run-id>",
            "status": "completed",
            "totalCases": 2,
            "totalDurationMs": "<totalDurationMs>",
          },
          "persistedCases": [
            {
              "caseId": "simple-text",
              "response": [
                {
                  "kind": "markdown",
                  "text": "Approved refund for: I want a refund for order #123",
                },
              ],
              "score": 1,
              "trial": 0,
            },
            {
              "caseId": "simple-text",
              "response": [
                {
                  "kind": "markdown",
                  "text": "Approved refund for: I want a refund for order #123",
                },
              ],
              "score": 1,
              "trial": 1,
            },
          ],
        }
      `);
    });
  });
});
