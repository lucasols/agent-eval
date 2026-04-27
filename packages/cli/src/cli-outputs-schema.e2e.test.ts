import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI output schemas', () => {
  test('persists outputsSchema validation failures without dropping unconfigured outputs', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      await writeFile(
        resolve(
          workspacePath,
          'evals/support/playground/output-schema.eval.ts',
        ),
        `import { defineEval, setEvalOutput, z } from '@ls-stack/agent-eval';

const outputsSchema = z.object({
  response: z.string(),
}).strict();

defineEval({
  id: 'output-schema-validation',
  title: 'Output Schema Validation',
  cases: [{ id: 'invalid-output', input: { response: 42 } }],
  outputsSchema,
  execute: ({ input }) => {
    setEvalOutput('response', input.response);
    setEvalOutput('unconfiguredNote', 'kept as-is');
  },
  scores: {
    mentionsRefund: {
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.response.includes('refund') ? 1 : 0),
    },
  },
});
`,
      );

      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'output-schema-validation',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const [caseRow] = artifacts.cases;
      expect(caseRow).toMatchObject({
        caseId: 'invalid-output',
        status: 'fail',
        columns: { response: 42, unconfiguredNote: 'kept as-is' },
      });
      expect(caseRow?.columns.mentionsRefund).toBeUndefined();

      const detail = artifacts.caseDetails['invalid-output.json'];
      expect(detail?.assertionFailures[0]?.message).toContain(
        'outputsSchema validation failed',
      );
      expect(detail?.assertionFailures[0]?.message).toContain(
        'response: Invalid input: expected string, received number',
      );

      expect(
        normalizeSnapshotValue(workspacePath, {
          caseRows: artifacts.cases.map((row) => ({
            caseId: row.caseId,
            columns: row.columns,
            status: row.status,
          })),
          summary: artifacts.summary,
        }),
      ).toMatchInlineSnapshot(`
        {
          "caseRows": [
            {
              "caseId": "invalid-output",
              "columns": {
                "response": 42,
                "unconfiguredNote": "kept as-is",
              },
              "status": "fail",
            },
          ],
          "summary": {
            "cancelledCases": 0,
            "errorCases": 0,
            "errorMessage": null,
            "failedCases": 1,
            "passedCases": 0,
            "runId": "<run-id>",
            "status": "completed",
            "totalCases": 1,
            "totalDurationMs": "<totalDurationMs>",
          },
        }
      `);
    });
  });
});
