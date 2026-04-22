import type { EvalTraceSpan } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  readSingleRunArtifacts,
  runExampleCli,
  summarizeTrace,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI eval features', () => {
  test('runs a module-mocked eval when node:test module mocks are enabled', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(
        workspacePath,
        ['run', '--eval', 'module-mock-demo'],
        { env: undefined, nodeArgs: ['--experimental-test-module-mocks'] },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      expect(
        normalizeSnapshotValue(workspacePath, {
          caseRows: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            columns: caseRow.columns,
            score: caseRow.score,
            status: caseRow.status,
          })),
          summary: artifacts.summary,
        }),
      ).toMatchInlineSnapshot(`
        {
          "caseRows": [
            {
              "caseId": "mocked-customer-lookup",
              "columns": {
                "appliedSegment": "vip",
                "response": "Priority refund approved for vip-100: Please refund the duplicate charge",
                "usedVipSegment": 1,
              },
              "score": 1,
              "status": "pass",
            },
          ],
          "summary": {
            "averageScore": 1,
            "cancelledCases": 0,
            "cost": {
              "totalUsd": null,
            },
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

  test('applies workspace concurrency to end-to-end example runs', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const runDurationMs = artifacts.summary.totalDurationMs;
      expect(runDurationMs).not.toBeNull();
      if (runDurationMs === null) {
        return;
      }

      let totalCaseLatencyMs = 0;
      for (const caseRow of artifacts.cases) {
        expect(typeof caseRow.latencyMs).toBe('number');
        totalCaseLatencyMs += caseRow.latencyMs ?? 0;
      }

      expect(totalCaseLatencyMs - runDurationMs).toBeGreaterThan(250);
    });
  });

  test('persists output columns, scores, and derived columns for every example case', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const simpleTextCase = requireCase(artifacts.cases, 'simple-text');
      const withImageCase = requireCase(artifacts.cases, 'with-image');
      const withAudioCase = requireCase(artifacts.cases, 'with-audio');

      for (const caseRow of artifacts.cases) {
        expect(caseRow.status).toBe('pass');
        expect(typeof caseRow.score).toBe('number');
        expect(caseRow.score).toBeGreaterThan(0.8);
        expect(caseRow.columns.mentionsRefund).toBe(1);
        expect(typeof caseRow.columns.reviewConfidence).toBe('number');
        expect(caseRow.columns.llmTurns).toBe(1);
        expect(typeof caseRow.columns.costUsd).toBe('number');
        expect(typeof caseRow.columns.response).toBe('string');
      }

      expect(simpleTextCase.columns.toolCalls).toBe(1);
      expect(withImageCase.columns.toolCalls).toBe(2);
      expect(withAudioCase.columns.toolCalls).toBe(1);
      expect(withImageCase.columns.response).toBe(
        'Approved refund for: Please refund this damaged item',
      );

      expect(
        normalizeSnapshotValue(
          workspacePath,
          artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            costUsd: caseRow.columns.costUsd,
            llmTurns: caseRow.columns.llmTurns,
            mentionsRefund: caseRow.columns.mentionsRefund,
            response: caseRow.columns.response,
            score: caseRow.score,
            status: caseRow.status,
            toolCalls: caseRow.columns.toolCalls,
          })),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "caseId": "simple-text",
            "costUsd": 0.0008749999999999999,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "response": "Approved refund for: I want a refund for order #123",
            "score": 0.8200000000000001,
            "status": "pass",
            "toolCalls": 1,
          },
          {
            "caseId": "with-image",
            "costUsd": 0.0008749999999999999,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "response": "Approved refund for: Please refund this damaged item",
            "score": 0.9199999999999999,
            "status": "pass",
            "toolCalls": 2,
          },
          {
            "caseId": "with-audio",
            "costUsd": 0.0008749999999999999,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "response": "Approved refund for: I need to return this product",
            "score": 0.98,
            "status": "pass",
            "toolCalls": 1,
          },
        ]
      `);
    });
  });

  test('persists multimodal inputs and trace display transforms in run artifacts', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'refund-workflow',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const simpleTextTrace = requireTrace(
        artifacts.traces,
        'simple-text.json',
      );
      const withImageTrace = requireTrace(artifacts.traces, 'with-image.json');
      const withAudioTrace = requireTrace(artifacts.traces, 'with-audio.json');

      const simpleTextAgent = requireSpan(simpleTextTrace, 'refund-workflow');
      const withImageAgent = requireSpan(withImageTrace, 'refund-workflow');
      const withAudioAgent = requireSpan(withAudioTrace, 'refund-workflow');
      const withImagePlan = requireSpan(withImageTrace, 'plan-refund');

      expect(simpleTextAgent.attributes?.input).toEqual({
        locale: 'en-US',
        message: 'I want a refund for order #123',
      });
      expect(withImageAgent.attributes?.input).toEqual({
        message: 'Please refund this damaged item',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      });
      expect(withAudioAgent.attributes?.input).toEqual({
        message: 'I need to return this product',
        voiceNote: 'evals/datasets/assets/note-1.mp3',
      });
      expect(
        withImageTrace.some((span) => span.name === 'inspect-receipt'),
      ).toBe(true);
      expect(
        withAudioTrace.some((span) => span.name === 'inspect-receipt'),
      ).toBe(false);
      expect(withImagePlan.attributes?.model).toBe('gpt-4o-mini');
      expect(withImagePlan.attributes?.usage).toEqual({
        inputTokens: 150,
        outputTokens: 50,
      });
      expect(withImagePlan.attributes?.costUsd).toBe(0.0008749999999999999);
      expect(
        readDisplayString(withImagePlan.attributes?.__display, 'costBrl'),
      ).toBe('R$ 0,00');
      expect(getDurationMs(simpleTextAgent)).toBeGreaterThanOrEqual(400);
      expect(getDurationMs(withImagePlan)).toBeGreaterThanOrEqual(180);

      let totalCaseCost = 0;
      for (const caseRow of artifacts.cases) {
        const costUsd = caseRow.columns.costUsd;
        if (typeof costUsd === 'number') {
          totalCaseCost += costUsd;
        }
      }
      expect(artifacts.summary.cost.totalUsd).toBe(totalCaseCost);

      expect(
        normalizeSnapshotValue(workspacePath, {
          summary: artifacts.summary,
          traces: {
            'simple-text.json': summarizeTrace(simpleTextTrace),
            'with-audio.json': summarizeTrace(withAudioTrace),
            'with-image.json': summarizeTrace(withImageTrace),
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "summary": {
            "averageScore": 0.9066666666666666,
            "cancelledCases": 0,
            "cost": {
              "totalUsd": 0.0026249999999999997,
            },
            "errorCases": 0,
            "errorMessage": null,
            "failedCases": 0,
            "passedCases": 3,
            "runId": "<run-id>",
            "status": "completed",
            "totalCases": 3,
            "totalDurationMs": "<totalDurationMs>",
          },
          "traces": {
            "simple-text.json": [
              {
                "display": undefined,
                "input": {
                  "locale": "en-US",
                  "message": "I want a refund for order #123",
                },
                "kind": "agent",
                "model": undefined,
                "name": "refund-workflow",
                "output": {
                  "approved": true,
                  "finalText": "Approved refund for: I want a refund for order #123",
                },
                "parentId": null,
                "usage": undefined,
                "value": undefined,
              },
              {
                "display": {
                  "costBrl": "R$ 0,00",
                },
                "input": {
                  "prompt": "I want a refund for order #123",
                },
                "kind": "llm",
                "model": "gpt-4o-mini",
                "name": "plan-refund",
                "output": {
                  "plan": "approve refund",
                },
                "parentId": "<span-id>",
                "usage": {
                  "inputTokens": 150,
                  "outputTokens": 50,
                },
                "value": undefined,
              },
              {
                "display": undefined,
                "input": {
                  "message": "I want a refund for order #123",
                },
                "kind": "tool",
                "model": undefined,
                "name": "process-refund",
                "output": {
                  "approved": true,
                  "finalText": "Approved refund for: I want a refund for order #123",
                },
                "parentId": "<span-id>",
                "usage": undefined,
                "value": undefined,
              },
              {
                "display": undefined,
                "input": undefined,
                "kind": "checkpoint",
                "model": undefined,
                "name": "decision",
                "output": undefined,
                "parentId": "<span-id>",
                "usage": undefined,
                "value": {
                  "approved": true,
                },
              },
            ],
            "with-audio.json": [
              {
                "display": undefined,
                "input": {
                  "message": "I need to return this product",
                  "voiceNote": "evals/datasets/assets/note-1.mp3",
                },
                "kind": "agent",
                "model": undefined,
                "name": "refund-workflow",
                "output": {
                  "approved": true,
                  "finalText": "Approved refund for: I need to return this product",
                },
                "parentId": null,
                "usage": undefined,
                "value": undefined,
              },
              {
                "display": {
                  "costBrl": "R$ 0,00",
                },
                "input": {
                  "prompt": "I need to return this product",
                },
                "kind": "llm",
                "model": "gpt-4o-mini",
                "name": "plan-refund",
                "output": {
                  "plan": "approve refund",
                },
                "parentId": "<span-id>",
                "usage": {
                  "inputTokens": 150,
                  "outputTokens": 50,
                },
                "value": undefined,
              },
              {
                "display": undefined,
                "input": {
                  "message": "I need to return this product",
                },
                "kind": "tool",
                "model": undefined,
                "name": "process-refund",
                "output": {
                  "approved": true,
                  "finalText": "Approved refund for: I need to return this product",
                },
                "parentId": "<span-id>",
                "usage": undefined,
                "value": undefined,
              },
              {
                "display": undefined,
                "input": undefined,
                "kind": "checkpoint",
                "model": undefined,
                "name": "decision",
                "output": undefined,
                "parentId": "<span-id>",
                "usage": undefined,
                "value": {
                  "approved": true,
                },
              },
            ],
            "with-image.json": [
              {
                "display": undefined,
                "input": {
                  "message": "Please refund this damaged item",
                  "receiptImage": "evals/datasets/assets/receipt-1.png",
                },
                "kind": "agent",
                "model": undefined,
                "name": "refund-workflow",
                "output": {
                  "approved": true,
                  "finalText": "Approved refund for: Please refund this damaged item",
                },
                "parentId": null,
                "usage": undefined,
                "value": undefined,
              },
              {
                "display": {
                  "costBrl": "R$ 0,00",
                },
                "input": {
                  "prompt": "Please refund this damaged item",
                },
                "kind": "llm",
                "model": "gpt-4o-mini",
                "name": "plan-refund",
                "output": {
                  "plan": "approve refund",
                },
                "parentId": "<span-id>",
                "usage": {
                  "inputTokens": 150,
                  "outputTokens": 50,
                },
                "value": undefined,
              },
              {
                "display": undefined,
                "input": {
                  "path": "evals/datasets/assets/receipt-1.png",
                },
                "kind": "tool",
                "model": undefined,
                "name": "inspect-receipt",
                "output": {
                  "verified": true,
                },
                "parentId": "<span-id>",
                "usage": undefined,
                "value": undefined,
              },
              {
                "display": undefined,
                "input": {
                  "message": "Please refund this damaged item",
                },
                "kind": "tool",
                "model": undefined,
                "name": "process-refund",
                "output": {
                  "approved": true,
                  "finalText": "Approved refund for: Please refund this damaged item",
                },
                "parentId": "<span-id>",
                "usage": undefined,
                "value": undefined,
              },
              {
                "display": undefined,
                "input": undefined,
                "kind": "checkpoint",
                "model": undefined,
                "name": "decision",
                "output": undefined,
                "parentId": "<span-id>",
                "usage": undefined,
                "value": {
                  "approved": true,
                },
              },
            ],
          },
        }
      `);
    });
  });

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
      expect(
        normalizeSnapshotValue(workspacePath, {
          caseRows: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            columns: caseRow.columns,
            status: caseRow.status,
          })),
        }),
      ).toMatchInlineSnapshot(`
{
  "caseRows": [
    {
      "caseId": "all-column-formats",
      "columns": {
        "attachment": {
          "mimeType": "text/plain",
          "path": "evals/datasets/assets/refund-template.txt",
          "source": "repo",
        },
        "audioBrief": {
          "mimeType": "audio/wav",
          "path": "evals/datasets/assets/chime.wav",
          "source": "repo",
        },
        "confidence": 0.93,
        "handlingCostUsd": 1.25,
        "previewCard": {
          "mimeType": "image/svg+xml",
          "path": "evals/datasets/assets/status-card.svg",
          "source": "repo",
        },
        "requiresManualReview": false,
        "response": "Prepared **refund package** for order \`A-1024\`.\n\nCustomer note: Please confirm the refund package for my damaged mug.",
        "reviewTimeMs": 1450,
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
}
      `);
    });
  });
  test('treats score failures and assertion failures as failed cases while allowing silent no-trace cases', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'score-threshold-demo,assertion-failure-demo,silent-pass-demo,silent-assertion-demo',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const scoreThresholdCase = requireCase(
        artifacts.cases,
        'score-threshold-miss',
      );
      const assertionFailureCase = requireCase(
        artifacts.cases,
        'assertion-failure-visible-output',
      );
      const silentPassCase = requireCase(
        artifacts.cases,
        'silent-pass-demo-no-output',
      );
      const silentAssertionCase = requireCase(
        artifacts.cases,
        'silent-assertion-no-output',
      );
      const assertionFailureDetail = requireCaseDetail(
        artifacts.caseDetails,
        'assertion-failure-visible-output',
      );
      const silentAssertionDetail = requireCaseDetail(
        artifacts.caseDetails,
        'silent-assertion-no-output',
      );

      expect(artifacts.summary.status).toBe('completed');
      expect(artifacts.summary.failedCases).toBe(3);
      expect(artifacts.summary.errorCases).toBe(0);
      expect(artifacts.summary.passedCases).toBe(1);

      expect(scoreThresholdCase.status).toBe('fail');
      expect(scoreThresholdCase.score).toBe(0);
      expect(assertionFailureCase.status).toBe('fail');
      expect(assertionFailureCase.score).toBe(null);
      expect(silentPassCase.status).toBe('pass');
      expect(silentPassCase.score).toBe(null);
      expect(silentAssertionCase.status).toBe('fail');
      expect(silentAssertionCase.score).toBe(null);

      expect(silentPassCase.columns).toEqual({});
      expect(silentAssertionCase.columns).toEqual({});
      expect(
        requireTrace(artifacts.traces, 'silent-pass-demo-no-output.json'),
      ).toEqual([]);
      expect(
        requireTrace(artifacts.traces, 'silent-assertion-no-output.json'),
      ).toEqual([]);

      expect(assertionFailureDetail.assertionFailures).toHaveLength(1);
      expect(assertionFailureDetail.assertionFailures[0]?.message).toBe(
        'operator note must be attached before closing the ticket',
      );
      expect(assertionFailureDetail.assertionFailures[0]?.stack).toContain(
        'EvalAssertionError: operator note must be attached before closing the ticket',
      );
      expect(silentAssertionDetail.assertionFailures).toHaveLength(1);
      expect(silentAssertionDetail.assertionFailures[0]?.message).toBe(
        'manual review queue must leave a handoff note',
      );
      expect(silentAssertionDetail.assertionFailures[0]?.stack).toContain(
        'EvalAssertionError: manual review queue must leave a handoff note',
      );

      expect(
        normalizeSnapshotValue(workspacePath, {
          summary: artifacts.summary,
          cases: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            columns: caseRow.columns,
            evalId: caseRow.evalId,
            score: caseRow.score,
            status: caseRow.status,
          })),
          traces: {
            'silent-assertion-no-output.json': summarizeTrace(
              requireTrace(artifacts.traces, 'silent-assertion-no-output.json'),
            ),
            'silent-pass-demo-no-output.json': summarizeTrace(
              requireTrace(artifacts.traces, 'silent-pass-demo-no-output.json'),
            ),
          },
          caseDetails: {
            'assertion-failure-visible-output.json': {
              assertionFailures: assertionFailureDetail.assertionFailures.map(
                (failure) => ({
                  message: failure.message,
                  stack: failure.stack ? '<stack>' : undefined,
                }),
              ),
            },
            'silent-assertion-no-output.json': {
              assertionFailures: silentAssertionDetail.assertionFailures.map(
                (failure) => ({
                  message: failure.message,
                  stack: failure.stack ? '<stack>' : undefined,
                }),
              ),
            },
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "caseDetails": {
            "assertion-failure-visible-output.json": {
              "assertionFailures": [
                {
                  "message": "operator note must be attached before closing the ticket",
                  "stack": "<stack>",
                },
              ],
            },
            "silent-assertion-no-output.json": {
              "assertionFailures": [
                {
                  "message": "manual review queue must leave a handoff note",
                  "stack": "<stack>",
                },
              ],
            },
          },
          "cases": [
            {
              "caseId": "score-threshold-miss",
              "columns": {
                "matchesGoldAnswer": 0,
                "response": "Borderline result for: Review the refund summary against the gold answer.",
              },
              "evalId": "score-threshold-demo",
              "score": 0,
              "status": "fail",
            },
            {
              "caseId": "assertion-failure-visible-output",
              "columns": {
                "response": "Missing audit note for ticket T-441.",
              },
              "evalId": "assertion-failure-demo",
              "score": null,
              "status": "fail",
            },
            {
              "caseId": "silent-pass-demo-no-output",
              "columns": {},
              "evalId": "silent-pass-demo",
              "score": null,
              "status": "pass",
            },
            {
              "caseId": "silent-assertion-no-output",
              "columns": {},
              "evalId": "silent-assertion-demo",
              "score": null,
              "status": "fail",
            },
          ],
          "summary": {
            "averageScore": 0,
            "cancelledCases": 0,
            "cost": {
              "totalUsd": null,
            },
            "errorCases": 0,
            "errorMessage": null,
            "failedCases": 3,
            "passedCases": 1,
            "runId": "<run-id>",
            "status": "completed",
            "totalCases": 4,
            "totalDurationMs": "<totalDurationMs>",
          },
          "traces": {
            "silent-assertion-no-output.json": [],
            "silent-pass-demo-no-output.json": [],
          },
        }
      `);
    });
  });
});

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

function requireCaseDetail<TCaseDetail extends { caseId: string }>(
  caseDetails: Record<string, TCaseDetail>,
  caseId: string,
): TCaseDetail {
  const caseDetail = caseDetails[`${encodeURIComponent(caseId)}.json`];
  if (caseDetail === undefined) {
    throw new Error(`Expected case detail ${caseId}`);
  }
  return caseDetail;
}

function requireTrace(
  traces: Record<string, EvalTraceSpan[]>,
  traceFileName: string,
): EvalTraceSpan[] {
  const trace = traces[traceFileName];
  if (trace === undefined) {
    throw new Error(`Expected trace ${traceFileName}`);
  }
  return trace;
}

function requireSpan(trace: EvalTraceSpan[], name: string): EvalTraceSpan {
  const span = trace.find((entry) => entry.name === name);
  if (span === undefined) {
    throw new Error(`Expected span ${name}`);
  }
  return span;
}

function readDisplayString(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || !(key in value)) {
    return undefined;
  }

  const displayValue = value[key];
  return typeof displayValue === 'string'
    ? displayValue.replaceAll('\u00A0', ' ')
    : undefined;
}

function getDurationMs(span: EvalTraceSpan): number {
  if (span.endedAt === null) {
    throw new Error(`Expected completed span ${span.name}`);
  }

  return new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
