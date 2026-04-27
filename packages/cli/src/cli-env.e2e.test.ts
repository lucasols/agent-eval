import { writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  normalizeTextSnapshot,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI env loading', () => {
  test('loads workspace .env for eval commands unless disabled', async () => {
    const loaded = await runEnvironmentConfigScenario({
      args: ['run', '--eval', 'environment-config-demo'],
      childQueue: undefined,
    });
    const disabled = await runEnvironmentConfigScenario({
      args: ['--no-env', 'run', '--eval', 'environment-config-demo'],
      childQueue: undefined,
    });
    const overridden = await runEnvironmentConfigScenario({
      args: ['run', '--eval', 'environment-config-demo'],
      childQueue: 'priority-escalations',
    });

    expect(loaded.queue).toBe('priority-refunds');
    expect(disabled.queue).toBe('standard-refund-queue');
    expect(overridden.queue).toBe('priority-escalations');
    expect({ loaded, disabled, overridden }).toMatchInlineSnapshot(`
      {
        "disabled": {
          "caseRows": [
            {
              "caseId": "route-refund-by-env",
              "columns": {
                "queue": "standard-refund-queue",
                "response": "Routed R-2048 for gold support via standard-refund-queue.",
                "routedToQueue": 1,
              },
              "status": "pass",
            },
          ],
          "exitCode": 0,
          "queue": "standard-refund-queue",
          "stderr": "",
          "stdout": "Run started: <run-id>
      Trials: 1
      
      --- Run Summary ---
      Status: completed
      Total: 1
      Passed: 1
      Failed: 0
      Errors: 0
      Pass Rate: 1/1
      Duration: <duration>",
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
        },
        "loaded": {
          "caseRows": [
            {
              "caseId": "route-refund-by-env",
              "columns": {
                "queue": "priority-refunds",
                "response": "Routed R-2048 for gold support via priority-refunds.",
                "routedToQueue": 1,
              },
              "status": "pass",
            },
          ],
          "exitCode": 0,
          "queue": "priority-refunds",
          "stderr": "",
          "stdout": "Run started: <run-id>
      Trials: 1
      
      --- Run Summary ---
      Status: completed
      Total: 1
      Passed: 1
      Failed: 0
      Errors: 0
      Pass Rate: 1/1
      Duration: <duration>",
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
        },
        "overridden": {
          "caseRows": [
            {
              "caseId": "route-refund-by-env",
              "columns": {
                "queue": "priority-escalations",
                "response": "Routed R-2048 for gold support via priority-escalations.",
                "routedToQueue": 1,
              },
              "status": "pass",
            },
          ],
          "exitCode": 0,
          "queue": "priority-escalations",
          "stderr": "",
          "stdout": "Run started: <run-id>
      Trials: 1
      
      --- Run Summary ---
      Status: completed
      Total: 1
      Passed: 1
      Failed: 0
      Errors: 0
      Pass Rate: 1/1
      Duration: <duration>",
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
        },
      }
    `);
  });
});

async function runEnvironmentConfigScenario({
  args,
  childQueue,
}: {
  args: string[];
  childQueue: string | undefined;
}): Promise<{
  caseRows: unknown;
  exitCode: number | null;
  queue: unknown;
  stderr: string;
  stdout: string;
  summary: unknown;
}> {
  return withIsolatedExampleWorkspace(async (workspacePath) => {
    await writeFile(
      `${workspacePath}/.env`,
      'AGENT_EVALS_SUPPORT_QUEUE=priority-refunds\n',
    );

    const result = await runExampleCli(workspacePath, args, {
      env: { AGENT_EVALS_SUPPORT_QUEUE: childQueue },
      nodeArgs: undefined,
    });
    const artifacts = await readSingleRunArtifacts(workspacePath);
    const caseRows = artifacts.cases.map((caseRow) => ({
      caseId: caseRow.caseId,
      columns: caseRow.columns,
      status: caseRow.status,
    }));
    const caseRow = requireCase(artifacts.cases, 'route-refund-by-env');

    return {
      caseRows: normalizeSnapshotValue(workspacePath, caseRows),
      exitCode: result.exitCode,
      queue: caseRow.columns.queue,
      stderr: result.stderr,
      stdout: normalizeTextSnapshot(workspacePath, result.stdout),
      summary: normalizeSnapshotValue(workspacePath, artifacts.summary),
    };
  });
}

function requireCase<TCase extends { caseId: string }>(
  cases: TCase[],
  caseId: string,
): TCase {
  const caseRow = cases.find((entry) => entry.caseId === caseId);
  if (caseRow === undefined) {
    throw new Error(`Expected case ${caseId}`);
  }
  return caseRow;
}
