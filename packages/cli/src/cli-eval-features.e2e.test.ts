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
  test('runs a module-mocked eval without requiring a manual node flag', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'module-mock-demo',
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
              "status": "pass",
            },
          ],
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

      let totalCaseDurationMs = 0;
      for (const caseRow of artifacts.cases) {
        expect(typeof caseRow.durationMs).toBe('number');
        totalCaseDurationMs += caseRow.durationMs ?? 0;
      }

      expect(totalCaseDurationMs - runDurationMs).toBeGreaterThan(250);
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
        expect(caseRow.columns.mentionsRefund).toBe(1);
        const reviewConfidence = caseRow.columns.reviewConfidence;
        expect(typeof reviewConfidence).toBe('number');
        if (typeof reviewConfidence === 'number') {
          expect(reviewConfidence).toBeGreaterThanOrEqual(0.6);
        }
        expect(caseRow.columns.llmTurns).toBe(1);
        expect(typeof caseRow.columns.costUsd).toBe('number');
        expect(caseRow.columns.inputTokens).toBe(150);
        expect(caseRow.columns.outputTokens).toBe(50);
        expect(caseRow.columns.cachedInputTokens).toBe(30);
        expect(caseRow.columns.cacheCreationInputTokens).toBe(80);
        expect(caseRow.columns.totalTokens).toBe(200);
        expect(typeof caseRow.columns.llmDurationMs).toBe('number');
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
            cacheCreationInputTokens: caseRow.columns.cacheCreationInputTokens,
            cachedInputTokens: caseRow.columns.cachedInputTokens,
            inputTokens: caseRow.columns.inputTokens,
            llmTurns: caseRow.columns.llmTurns,
            mentionsRefund: caseRow.columns.mentionsRefund,
            outputTokens: caseRow.columns.outputTokens,
            reviewConfidence: caseRow.columns.reviewConfidence,
            response: caseRow.columns.response,
            status: caseRow.status,
            totalTokens: caseRow.columns.totalTokens,
            toolCalls: caseRow.columns.toolCalls,
          })),
        ),
      ).toMatchInlineSnapshot(`
        [
          {
            "cacheCreationInputTokens": 80,
            "cachedInputTokens": 30,
            "caseId": "simple-text",
            "costUsd": 0.0008575000000000001,
            "inputTokens": 150,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "outputTokens": 50,
            "response": "Approved refund for: I want a refund for order #123",
            "reviewConfidence": 0.64,
            "status": "pass",
            "toolCalls": 1,
            "totalTokens": 200,
          },
          {
            "cacheCreationInputTokens": 80,
            "cachedInputTokens": 30,
            "caseId": "with-image",
            "costUsd": 0.0008575000000000001,
            "inputTokens": 150,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "outputTokens": 50,
            "response": "Approved refund for: Please refund this damaged item",
            "reviewConfidence": 0.84,
            "status": "pass",
            "toolCalls": 2,
            "totalTokens": 200,
          },
          {
            "cacheCreationInputTokens": 80,
            "cachedInputTokens": 30,
            "caseId": "with-audio",
            "costUsd": 0.0008575000000000001,
            "inputTokens": 150,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "outputTokens": 50,
            "response": "Approved refund for: I need to return this product",
            "reviewConfidence": 0.96,
            "status": "pass",
            "toolCalls": 1,
            "totalTokens": 200,
          },
        ]
      `);
    });
  });

  test('persists multimodal inputs and trace span attributes in run artifacts', async () => {
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
        cacheCreationInputTokens: 80,
        cachedInputTokens: 30,
        inputTokens: 150,
        outputTokens: 50,
      });
      expect(withImagePlan.attributes?.costUsd).toBeUndefined();
      expect(
        readDisplayString(withImagePlan.attributes?.__display, 'costBrl'),
      ).toBeUndefined();
      expect(getDurationMs(simpleTextAgent)).toBeGreaterThanOrEqual(400);
      expect(getDurationMs(withImagePlan)).toBeGreaterThanOrEqual(180);

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
            "cancelledCases": 0,
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
                "display": undefined,
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
                  "cacheCreationInputTokens": 80,
                  "cachedInputTokens": 30,
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
                "display": undefined,
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
                  "cacheCreationInputTokens": 80,
                  "cachedInputTokens": 30,
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
                "display": undefined,
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
                  "cacheCreationInputTokens": 80,
                  "cachedInputTokens": 30,
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
          "artifactId": "<run-id>__all-column-formats__t0__attachment__refund-template.txt",
          "fileName": "refund-template.txt",
          "mimeType": "text/plain",
          "source": "run",
        },
        "audioBrief": {
          "artifactId": "<run-id>__all-column-formats__t0__audioBrief__chime.wav",
          "fileName": "chime.wav",
          "mimeType": "audio/wav",
          "source": "run",
        },
        "automatedQuality": 0.8,
        "confidence": 0.93,
        "handlingCostUsd": 1.25,
        "previewCard": {
          "artifactId": "<run-id>__all-column-formats__t0__previewCard__previewCard.svg",
          "fileName": "previewCard.svg",
          "mimeType": "image/svg+xml",
          "source": "run",
        },
        "requestCount": 1200,
        "requiresManualReview": false,
        "response": "Prepared **refund package** for order \`A-1024\`.\n\nCustomer note: Please confirm the refund package for my damaged mug.",
        "reviewTimeMs": 1450,
        "reviewerDecision": null,
        "reviewerQuality": null,
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
      expect(scoreThresholdCase.columns.matchesGoldAnswer).toBe(0);
      expect(assertionFailureCase.status).toBe('fail');
      expect(silentPassCase.status).toBe('pass');
      expect(silentAssertionCase.status).toBe('fail');

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
              "status": "fail",
            },
            {
              "caseId": "assertion-failure-visible-output",
              "columns": {
                "response": "Missing audit note for ticket T-441.",
              },
              "evalId": "assertion-failure-demo",
              "status": "fail",
            },
            {
              "caseId": "silent-pass-demo-no-output",
              "columns": {},
              "evalId": "silent-pass-demo",
              "status": "pass",
            },
            {
              "caseId": "silent-assertion-no-output",
              "columns": {},
              "evalId": "silent-assertion-demo",
              "status": "fail",
            },
          ],
          "summary": {
            "cancelledCases": 0,
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
