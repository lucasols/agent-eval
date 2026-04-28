import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runSummarySchema } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  normalizeTextSnapshot,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

async function writeTrialSelectionEval(
  workspacePath: string,
  trialSelection: 'lowestScore' | 'median',
): Promise<void> {
  const configPath = join(workspacePath, 'agent-evals.config.ts');
  const nextConfig = (await readFile(configPath, 'utf8')).replace(
    "trialSelection: 'lowestScore',",
    `trialSelection: '${trialSelection}',`,
  );
  await writeFile(configPath, nextConfig);

  await writeFile(
    join(workspacePath, 'evals', 'trial-selection.eval.ts'),
    `import { defineEval, setEvalOutput, evalTracer, evalSpan } from '@ls-stack/agent-eval';

const candidates = [
  {
    candidateId: 'careful-follow-up',
    response: 'Ask for photos before issuing a refund.',
    score: 0.91,
  },
  {
    candidateId: 'unsafe-refund',
    response: 'Approve the refund immediately with no verification.',
    score: 0.22,
  },
  {
    candidateId: 'balanced-review',
    response: 'Offer a replacement after a quick damage review.',
    score: 0.64,
  },
];

let executionCount = 0;

function nextCandidate() {
  const candidate = candidates[executionCount % candidates.length];
  executionCount += 1;
  return candidate;
}

defineEval({
  id: 'trial-selection-eval',
  title: 'Trial Selection Eval',
  cases: [
    {
      id: 'damaged-order',
      input: { message: 'The order arrived damaged.' },
    },
  ],
  columns: {
    response: { label: 'Response' },
    candidateId: { label: 'Candidate' },
  },
  execute: async ({ input }) => {
    await evalTracer.span({ kind: 'agent', name: 'trial-selection' }, async () => {
      evalSpan.setAttribute('input', input);

      const candidate = await evalTracer.span(
        {
          kind: 'llm',
          name: 'draft-response',
          cache: { key: { message: input.message } },
        },
        async () => {
          const next = nextCandidate();
          setEvalOutput('candidateId', next.candidateId);
          setEvalOutput('response', next.response);
          setEvalOutput('scorePreview', next.score);
          evalSpan.setAttribute('output', next);
          return next;
        },
      );

      evalSpan.setAttribute('output', candidate);
    });
  },
  scores: {
    quality: {
      compute: ({ outputs }) =>
        typeof outputs.scorePreview === 'number' ? outputs.scorePreview : 0,
    },
  },
});
`,
  );
}

describe('CLI run targeting', () => {
  test('prints run help without starting a run', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, ['run', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('agent-evals run - Run evals');
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('--eval <id>');
      expect(result.stdout).toContain('--inspect[=host:port]');
      expect(result.stdout).toContain('--inspect-brk[=host:port]');
      expect(result.stdout).not.toContain('Run started:');
      expect(result.stdout).not.toContain('Total:');
      expect(existsSync(resolve(workspacePath, '.agent-evals/runs'))).toBe(
        false,
      );
    });
  });

  test('reports missing help for unknown commands', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, ['missing', '--help']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('No help found for "missing".');
      expect(existsSync(resolve(workspacePath, '.agent-evals/runs'))).toBe(
        false,
      );
    });
  });

  test('reports missing help for unknown cache subcommands', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'cache',
        'missing',
        '--help',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('No help found for "cache missing".');
      expect(existsSync(resolve(workspacePath, '.agent-evals/runs'))).toBe(
        false,
      );
    });
  });

  test('supports eval filters and comma-separated case filters', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text,with-image',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
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
        Total: 2
        Passed: 2
        Failed: 0
        Errors: 0
        Pass Rate: 2/2
        Duration: <duration>",
          "persistedCases": [
            {
              "caseId": "simple-text",
              "response": "Approved refund for: I want a refund for order #123",
              "status": "pass",
              "toolCalls": 1,
            },
            {
              "caseId": "with-image",
              "response": "Approved refund for: Please refund this damaged item",
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

  test('supports enabling the Node inspector for a targeted run', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--inspect=0',
        '--eval',
        'refund-workflow',
        '--case',
        'simple-text',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Debugger listening on');

      const summary = runSummarySchema.parse(JSON.parse(result.stdout));
      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(summary.totalCases).toBe(1);
      expect(artifacts.manifest.target).toEqual({
        caseIds: ['simple-text'],
        evalIds: ['refund-workflow'],
        mode: 'caseIds',
      });
      expect(artifacts.cases.map((caseRow) => caseRow.caseId)).toEqual([
        'simple-text',
      ]);
    });
  });

  test('runs evals discovered from files that register multiple evals', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'receipt-fraud-review',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Total: 1');

      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(artifacts.manifest.target.mode).toBe('evalIds');
      expect(artifacts.manifest.target.evalIds).toEqual([
        'receipt-fraud-review',
      ]);
      expect(artifacts.traceFiles).toEqual(['tampered-total.json']);
      expect(artifacts.cases.map((caseRow) => caseRow.caseId)).toEqual([
        'tampered-total',
      ]);

      expect(
        normalizeSnapshotValue(workspacePath, {
          commandOutput: normalizeTextSnapshot(workspacePath, result.stdout),
          persistedCases: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            evalId: caseRow.evalId,
            reviewQueue: caseRow.columns.reviewQueue,
            riskLevel: caseRow.columns.riskLevel,
            response: caseRow.columns.response,
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
        Pass Rate: 1/1
        Duration: <duration>",
          "persistedCases": [
            {
              "caseId": "tampered-total",
              "evalId": "receipt-fraud-review",
              "response": "Opened a risk review for order #RISK-12 after detecting receipt tampering signals.",
              "reviewQueue": "risk-ops",
              "riskLevel": "high",
              "status": "pass",
              "toolCalls": 2,
            },
          ],
          "target": {
            "evalIds": [
              "receipt-fraud-review",
            ],
            "mode": "evalIds",
          },
        }
      `);
    });
  });

  test('runs voice follow-up workflow with scenario-specific outputs', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'voice-return-follow-up',
        '--case',
        'pt-br-defect',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Total: 1');

      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(artifacts.manifest.target.evalIds).toEqual([
        'voice-return-follow-up',
      ]);
      expect(artifacts.traceFiles).toEqual(['pt-br-defect.json']);

      expect(
        normalizeSnapshotValue(workspacePath, {
          persistedCases: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            detectedLocale: caseRow.columns.detectedLocale,
            followUpChannel: caseRow.columns.followUpChannel,
            llmTurns: caseRow.columns.llmTurns,
            response: caseRow.columns.response,
          })),
        }),
      ).toMatchInlineSnapshot(`
        {
          "persistedCases": [
            {
              "caseId": "pt-br-defect",
              "detectedLocale": "pt-BR",
              "followUpChannel": "sms",
              "llmTurns": 2,
              "response": "Prepared a sms follow-up with return steps for order #RET-44.",
            },
          ],
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
            escalationQueue: caseRow.columns.escalationQueue,
            evalId: caseRow.evalId,
            response: caseRow.columns.response,
            riskLevel: caseRow.columns.riskLevel,
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
        Pass Rate: 1/1
        Duration: <duration>",
          "persistedCases": [
            {
              "caseId": "espresso-machine",
              "escalationQueue": "finance-review",
              "evalId": "high-value-refund",
              "response": "Escalated a $1299.00 refund for order #9001 to finance review.",
              "riskLevel": "high",
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

  test('supports json summaries and persists one winning case row for multi-trial runs', async () => {
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
      expect(summary.totalCases).toBe(1);
      expect(summary.passedCases).toBe(1);
      expect(artifacts.cases).toHaveLength(1);
      expect(artifacts.cases.map((caseRow) => caseRow.trial)).toEqual([0]);
      expect(artifacts.cases.map((caseRow) => caseRow.caseId)).toEqual([
        'simple-text',
      ]);

      expect(
        normalizeSnapshotValue(workspacePath, {
          jsonSummary: summary,
          persistedCases: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            response: caseRow.columns.response,
            mentionsRefund: caseRow.columns.mentionsRefund,
            reviewConfidence: caseRow.columns.reviewConfidence,
            trial: caseRow.trial,
          })),
        }),
      ).toMatchInlineSnapshot(`
        {
          "jsonSummary": {
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
          "persistedCases": [
            {
              "caseId": "simple-text",
              "mentionsRefund": 1,
              "response": "Approved refund for: I want a refund for order #123",
              "reviewConfidence": 0.64,
              "trial": 0,
            },
          ],
        }
      `);
    });
  });

  test('supports median trial selection from config', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      await writeTrialSelectionEval(workspacePath, 'median');

      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'trial-selection-eval',
        '--trials',
        '3',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const summary = runSummarySchema.parse(JSON.parse(result.stdout));
      const artifacts = await readSingleRunArtifacts(workspacePath);

      expect(summary.status).toBe('completed');
      expect(summary.totalCases).toBe(1);
      expect(artifacts.cases).toHaveLength(1);
      expect(artifacts.cases[0]).toMatchObject({
        caseId: 'damaged-order',
        trial: 2,
      });
      expect(artifacts.cases[0]?.columns.quality).toBe(0.64);

      expect(
        normalizeSnapshotValue(workspacePath, {
          jsonSummary: summary,
          persistedCases: artifacts.cases.map((caseRow) => ({
            candidateId: caseRow.columns.candidateId,
            caseId: caseRow.caseId,
            quality: caseRow.columns.quality,
            response: caseRow.columns.response,
            trial: caseRow.trial,
          })),
        }),
      ).toMatchInlineSnapshot(`
        {
          "jsonSummary": {
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
          "persistedCases": [
            {
              "candidateId": "balanced-review",
              "caseId": "damaged-order",
              "quality": 0.64,
              "response": "Offer a replacement after a quick damage review.",
              "trial": 2,
            },
          ],
        }
      `);
    });
  });
});
