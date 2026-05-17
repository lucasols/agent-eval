import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  normalizeTextSnapshot,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI run error details', () => {
  test('surfaces run-level setup errors from the example workspace', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'run-error-details-demo',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'Error running eval run-error-details-demo',
      );
      expect(result.stderr).toContain('refund-policy-cases.json');

      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(artifacts.cases).toEqual([]);
      expect(artifacts.caseDetails).toEqual({});
      expect(artifacts.summary.status).toBe('error');
      expect(artifacts.summary.totalCases).toBe(0);
      expect(artifacts.summary.errorMessage).toContain(
        '[run-error-details-demo] Error: ENOENT',
      );
      expect(artifacts.summary.errorMessage).toContain(
        'refund-policy-cases.json',
      );

      expect(
        normalizeSnapshotValue(workspacePath, {
          stdout: normalizeTextSnapshot(workspacePath, result.stdout),
          summary: artifacts.summary,
          cases: artifacts.cases,
          traceFiles: artifacts.traceFiles,
        }),
      ).toMatchInlineSnapshot(`
        {
          "cases": [],
          "stdout": "Run started: <run-id>
        Trials: 1

        --- Run Summary ---
        Status: error
        Total: 0
        Passed: 0
        Failed: 0
        Errors: 0
        Duration: <duration>

        [run-error-details-demo] Error: ENOENT: no such file or directory, open '<workspace>/evals/datasets/run-error/refund-policy-cases.json'
        at async open (node:internal/fs/promises:641:25)
            at async readFile (node:internal/fs/promises:1279:14)
            at async loadRefundPolicyDataset (file://<workspace>/evals/support/playground/run-error-details.eval.ts?v=<source-fingerprint>&agent-evals-isolate=<run-id>:5:10)
            at async Object.cases (file://<workspace>/evals/support/playground/run-error-details.eval.ts?v=<source-fingerprint>&agent-evals-isolate=<run-id>:18:33)
            at async runWithEvalClock.freezeTime (file://<repo>/packages/runner/src/runOrchestration.ts:547:29)
            at async runWithEvalClock (file://<repo>/packages/sdk/src/runtime.ts:387:10)
            at async file://<repo>/packages/runner/src/runOrchestration.ts:543:21
            at async file://<repo>/packages/runner/src/runOrchestration.ts:471:13
            at async runInEvalRuntimeScope (file://<repo>/packages/sdk/src/runtime.ts:791:12)
            at async file://<repo>/packages/runner/src/runOrchestration.ts:470:11",
          "summary": {
            "cancelledCases": 0,
            "errorCases": 0,
            "errorMessage": "[run-error-details-demo] Error: ENOENT: no such file or directory, open '<workspace>/evals/datasets/run-error/refund-policy-cases.json'
        at async open (node:internal/fs/promises:641:25)
            at async readFile (node:internal/fs/promises:1279:14)
            at async loadRefundPolicyDataset (file://<workspace>/evals/support/playground/run-error-details.eval.ts?v=<source-fingerprint>&agent-evals-isolate=<run-id>:5:10)
            at async Object.cases (file://<workspace>/evals/support/playground/run-error-details.eval.ts?v=<source-fingerprint>&agent-evals-isolate=<run-id>:18:33)
            at async runWithEvalClock.freezeTime (file://<repo>/packages/runner/src/runOrchestration.ts:547:29)
            at async runWithEvalClock (file://<repo>/packages/sdk/src/runtime.ts:387:10)
            at async file://<repo>/packages/runner/src/runOrchestration.ts:543:21
            at async file://<repo>/packages/runner/src/runOrchestration.ts:471:13
            at async runInEvalRuntimeScope (file://<repo>/packages/sdk/src/runtime.ts:791:12)
            at async file://<repo>/packages/runner/src/runOrchestration.ts:470:11",
            "failedCases": 0,
            "passedCases": 0,
            "runId": "<run-id>",
            "status": "error",
            "totalCases": 0,
            "totalDurationMs": "<totalDurationMs>",
          },
          "traceFiles": [],
        }
      `);
    });
  });
});
