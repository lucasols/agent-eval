import { runSummarySchema } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import {
  normalizeSnapshotValue,
  normalizeTextSnapshot,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

const runFileIndexSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  status: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  target: z.object({
    mode: z.string(),
    evalIds: z.array(z.string()).optional(),
    caseIds: z.array(z.string()).optional(),
  }),
  summary: runSummarySchema,
  files: z.object({
    dir: z.string(),
    run: z.string(),
    summary: z.string(),
    cases: z.string(),
    caseDetailsDir: z.string(),
    tracesDir: z.string(),
  }),
  cases: z.array(
    z.object({
      caseId: z.string(),
      evalId: z.string(),
      status: z.string(),
      files: z.object({ caseDetail: z.string(), trace: z.string() }),
    }),
  ),
});
const runFileIndexListSchema = z.array(runFileIndexSchema);

function parseJson<T>(schema: { parse(value: unknown): T }, text: string): T {
  const parsed: unknown = JSON.parse(text);
  return schema.parse(parsed);
}

describe('CLI saved run file index', () => {
  test('prints show-runs help without requiring saved runs', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'show-runs',
        '--help',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(
        'agent-evals show-runs - Show saved run artifact file paths',
      );
      expect(result.stdout).toContain(
        'agent-evals show-runs [<run-id>|latest]',
      );
    });
  });

  test('prints stable artifact paths for saved runs', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const runResult = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);

      expect(runResult.exitCode).toBe(0);
      expect(runResult.stderr).toBe('');

      const showRunsResult = await runExampleCli(workspacePath, ['show-runs']);
      expect(showRunsResult.exitCode).toBe(0);
      expect(showRunsResult.stderr).toBe('');
      expect(normalizeTextSnapshot(workspacePath, showRunsResult.stdout))
        .toMatchInlineSnapshot(`
          "Saved runs (1):

          r0 (<run-id>)  completed  1 total, 1 passed, 0 failed, 0 errors, 0 cancelled
            dir: <workspace>/.agent-evals/runs/<run-id>
            run: <workspace>/.agent-evals/runs/<run-id>/run.json
            summary: <workspace>/.agent-evals/runs/<run-id>/summary.json
            cases: <workspace>/.agent-evals/runs/<run-id>/cases.jsonl
            case details: <workspace>/.agent-evals/runs/<run-id>/case-details
            traces: <workspace>/.agent-evals/runs/<run-id>/traces
            case files:
              simple-text [refund-workflow] pass
                detail: <workspace>/.agent-evals/runs/<run-id>/case-details/simple-text.json
                trace: <workspace>/.agent-evals/runs/<run-id>/traces/simple-text.json"
        `);
    });
  });

  test('emits a JSON file index for latest or short-id lookup', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const runResult = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
      ]);
      expect(runResult.exitCode).toBe(0);

      const listResult = await runExampleCli(workspacePath, [
        'show-runs',
        '--json',
      ]);
      const indexes = parseJson(runFileIndexListSchema, listResult.stdout);
      expect(indexes.map((index) => index.shortId)).toEqual(['r0']);

      const latestResult = await runExampleCli(workspacePath, [
        'show-runs',
        'latest',
        '--json',
      ]);
      const latest = parseJson(runFileIndexSchema, latestResult.stdout);
      expect(latest.shortId).toBe('r0');

      const shortIdResult = await runExampleCli(workspacePath, [
        'show-runs',
        'r0',
        '--json',
      ]);
      const byShortId = parseJson(runFileIndexSchema, shortIdResult.stdout);
      expect(byShortId.id).toBe(latest.id);

      expect(normalizeSnapshotValue(workspacePath, { latest, list: indexes }))
        .toMatchInlineSnapshot(`
        {
          "latest": {
            "cases": [
              {
                "caseId": "simple-text",
                "evalId": "refund-workflow",
                "files": {
                  "caseDetail": "<workspace>/.agent-evals/runs/<run-id>/case-details/simple-text.json",
                  "trace": "<workspace>/.agent-evals/runs/<run-id>/traces/simple-text.json",
                },
                "status": "pass",
              },
            ],
            "endedAt": "<timestamp>",
            "files": {
              "caseDetailsDir": "<workspace>/.agent-evals/runs/<run-id>/case-details",
              "cases": "<workspace>/.agent-evals/runs/<run-id>/cases.jsonl",
              "dir": "<workspace>/.agent-evals/runs/<run-id>",
              "run": "<workspace>/.agent-evals/runs/<run-id>/run.json",
              "summary": "<workspace>/.agent-evals/runs/<run-id>/summary.json",
              "tracesDir": "<workspace>/.agent-evals/runs/<run-id>/traces",
            },
            "id": "<run-id>",
            "shortId": "r0",
            "startedAt": "<timestamp>",
            "status": "completed",
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
            "target": {
              "caseIds": [
                "simple-text",
              ],
              "evalIds": [
                "refund-workflow",
              ],
              "mode": "caseIds",
            },
          },
          "list": [
            {
              "cases": [
                {
                  "caseId": "simple-text",
                  "evalId": "refund-workflow",
                  "files": {
                    "caseDetail": "<workspace>/.agent-evals/runs/<run-id>/case-details/simple-text.json",
                    "trace": "<workspace>/.agent-evals/runs/<run-id>/traces/simple-text.json",
                  },
                  "status": "pass",
                },
              ],
              "endedAt": "<timestamp>",
              "files": {
                "caseDetailsDir": "<workspace>/.agent-evals/runs/<run-id>/case-details",
                "cases": "<workspace>/.agent-evals/runs/<run-id>/cases.jsonl",
                "dir": "<workspace>/.agent-evals/runs/<run-id>",
                "run": "<workspace>/.agent-evals/runs/<run-id>/run.json",
                "summary": "<workspace>/.agent-evals/runs/<run-id>/summary.json",
                "tracesDir": "<workspace>/.agent-evals/runs/<run-id>/traces",
              },
              "id": "<run-id>",
              "shortId": "r0",
              "startedAt": "<timestamp>",
              "status": "completed",
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
              "target": {
                "caseIds": [
                  "simple-text",
                ],
                "evalIds": [
                  "refund-workflow",
                ],
                "mode": "caseIds",
              },
            },
          ],
        }
      `);
    });
  });
});
