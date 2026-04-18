import { describe, expect, test } from 'vitest';
import { displayBlockSchema, type EvalTraceSpan } from '@agent-evals/shared';
import { z } from 'zod/v4';
import {
  normalizeSnapshotValue,
  readSingleRunArtifacts,
  runExampleCli,
  summarizeTrace,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

const displayBlocksSchema = z.array(displayBlockSchema);

describe('CLI eval features', () => {
  test('persists output blocks, scores, and derived columns for every example case', async () => {
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
        const responseBlocks = displayBlocksSchema.parse(caseRow.columns.response);

        expect(caseRow.status).toBe('pass');
        expect(typeof caseRow.score).toBe('number');
        expect(caseRow.score).toBeGreaterThan(0.8);
        expect(caseRow.columns.mentionsRefund).toBe(1);
        expect(typeof caseRow.columns.reviewConfidence).toBe('number');
        expect(caseRow.columns.llmTurns).toBe(1);
        expect(typeof caseRow.columns.costUsd).toBe('number');
        expect(responseBlocks).toHaveLength(1);
        expect(responseBlocks[0]?.kind).toBe('markdown');
      }

      expect(simpleTextCase.columns.toolCalls).toBe(1);
      expect(withImageCase.columns.toolCalls).toBe(2);
      expect(withAudioCase.columns.toolCalls).toBe(1);
      expect(withImageCase.columns.response).toEqual([
        {
          kind: 'markdown',
          text: 'Approved refund for: Please refund this damaged item',
        },
      ]);

      expect(
        normalizeSnapshotValue(
          workspacePath,
          artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            costUsd: caseRow.columns.costUsd,
            llmTurns: caseRow.columns.llmTurns,
            mentionsRefund: caseRow.columns.mentionsRefund,
            response: displayBlocksSchema.parse(caseRow.columns.response),
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
            "response": [
              {
                "kind": "markdown",
                "text": "Approved refund for: I want a refund for order #123",
              },
            ],
            "score": 0.8200000000000001,
            "status": "pass",
            "toolCalls": 1,
          },
          {
            "caseId": "with-image",
            "costUsd": 0.0008749999999999999,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "response": [
              {
                "kind": "markdown",
                "text": "Approved refund for: Please refund this damaged item",
              },
            ],
            "score": 0.9199999999999999,
            "status": "pass",
            "toolCalls": 2,
          },
          {
            "caseId": "with-audio",
            "costUsd": 0.0008749999999999999,
            "llmTurns": 1,
            "mentionsRefund": 1,
            "response": [
              {
                "kind": "markdown",
                "text": "Approved refund for: I need to return this product",
              },
            ],
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
      const simpleTextTrace = requireTrace(artifacts.traces, 'simple-text.json');
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
      expect(withImageTrace.some((span) => span.name === 'inspect-receipt')).toBe(
        true,
      );
      expect(withAudioTrace.some((span) => span.name === 'inspect-receipt')).toBe(
        false,
      );
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
              "savingsUsd": null,
              "totalUsd": 0.0026249999999999997,
              "uncachedUsd": null,
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
      const silentPassCase = requireCase(artifacts.cases, 'silent-pass-no-output');
      const silentAssertionCase = requireCase(
        artifacts.cases,
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
      expect(requireTrace(artifacts.traces, 'silent-pass-no-output.json')).toEqual(
        [],
      );
      expect(
        requireTrace(artifacts.traces, 'silent-assertion-no-output.json'),
      ).toEqual([]);

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
            'silent-pass-no-output.json': summarizeTrace(
              requireTrace(artifacts.traces, 'silent-pass-no-output.json'),
            ),
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "cases": [
            {
              "caseId": "score-threshold-miss",
              "columns": {
                "matchesGoldAnswer": 0,
                "response": [
                  {
                    "kind": "markdown",
                    "text": "Borderline result for: Review the refund summary against the gold answer.",
                  },
                ],
              },
              "evalId": "score-threshold-demo",
              "score": 0,
              "status": "fail",
            },
            {
              "caseId": "assertion-failure-visible-output",
              "columns": {
                "response": [
                  {
                    "kind": "markdown",
                    "text": "Missing audit note for ticket T-441.",
                  },
                ],
              },
              "evalId": "assertion-failure-demo",
              "score": null,
              "status": "fail",
            },
            {
              "caseId": "silent-pass-no-output",
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
              "savingsUsd": null,
              "totalUsd": null,
              "uncachedUsd": null,
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
            "silent-pass-no-output.json": [],
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

function readDisplayString(
  value: unknown,
  key: string,
): string | undefined {
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

  return (
    new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
