import type { EvalTraceSpan } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI span error examples', () => {
  test('persists captured and thrown span errors from example evals', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'captured-span-errors-demo,errored-span-demo',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const artifacts = await readSingleRunArtifacts(workspacePath);
      const capturedTrace = requireTrace(
        artifacts.traces,
        'recover-with-fallback-signals.json',
      );
      const capturedSpan = requireSpan(
        capturedTrace,
        'load-optional-risk-signals',
      );
      const erroredTrace = requireTrace(
        artifacts.traces,
        'recover-after-webhook-error.json',
      );
      const erroredSpan = requireSpan(erroredTrace, 'submit-refund-webhook');

      expect(capturedSpan.status).toBe('error');
      expect(capturedSpan.error).toMatchObject({
        category: 'sla',
        details: { service: 'manualReviewSla', timeoutMs: 1500 },
        domain: 'operations',
        name: 'Error',
        message: 'Manual review SLA lookup timed out',
      });
      expect(capturedSpan.errors).toMatchObject([
        {
          category: 'optional-signal',
          details: { fallback: 'loyaltyTier', signal: 'fraudVelocity' },
          domain: 'risk',
          name: 'Error',
          message: 'Fraud velocity signal unavailable',
        },
        {
          category: 'sla',
          details: { service: 'manualReviewSla', timeoutMs: 1500 },
          domain: 'operations',
          name: 'Error',
          message: 'Manual review SLA lookup timed out',
        },
      ]);
      for (const error of capturedSpan.errors ?? []) {
        expect(typeof error.capturedAt).toBe('string');
        expect(Number.isNaN(Date.parse(error.capturedAt ?? ''))).toBe(false);
      }
      expect(capturedSpan.error?.capturedAt).toBe(
        capturedSpan.errors?.at(-1)?.capturedAt,
      );
      expect(capturedSpan.attributes).toMatchObject({
        fallbackSignals: ['loyaltyTier', 'requestedRefundUsd'],
      });
      expect(erroredSpan.status).toBe('error');
      expect(erroredSpan.error).toMatchObject({
        name: 'Error',
        message: 'Refund webhook rejected #884',
      });
      expect(erroredSpan.errors).toBeUndefined();

      expect(
        normalizeSnapshotValue(workspacePath, {
          summary: artifacts.summary,
          caseRows: artifacts.cases.map((caseRow) => ({
            caseId: caseRow.caseId,
            columns: caseRow.columns,
            status: caseRow.status,
          })),
          capturedSpan: {
            name: capturedSpan.name,
            status: capturedSpan.status,
            error: capturedSpan.error
              ? {
                  name: capturedSpan.error.name,
                  message: capturedSpan.error.message,
                  stack: capturedSpan.error.stack ? '<stack>' : undefined,
                  capturedAt: capturedSpan.error.capturedAt
                    ? '<capturedAt>'
                    : undefined,
                  category: capturedSpan.error.category,
                  details: capturedSpan.error.details,
                  domain: capturedSpan.error.domain,
                }
              : undefined,
            errors: capturedSpan.errors?.map((error) => ({
              category: error.category,
              details: error.details,
              domain: error.domain,
              name: error.name,
              message: error.message,
              stack: error.stack ? '<stack>' : undefined,
              capturedAt: error.capturedAt ? '<capturedAt>' : undefined,
            })),
            fallbackSignals: capturedSpan.attributes?.fallbackSignals,
          },
          erroredSpan: {
            name: erroredSpan.name,
            status: erroredSpan.status,
            error: erroredSpan.error
              ? {
                  name: erroredSpan.error.name,
                  message: erroredSpan.error.message,
                  stack: erroredSpan.error.stack ? '<stack>' : undefined,
                }
              : undefined,
            errors: erroredSpan.errors,
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "capturedSpan": {
            "error": {
              "capturedAt": "<capturedAt>",
              "category": "sla",
              "details": {
                "service": "manualReviewSla",
                "timeoutMs": 1500,
              },
              "domain": "operations",
              "message": "Manual review SLA lookup timed out",
              "name": "Error",
              "stack": undefined,
            },
            "errors": [
              {
                "capturedAt": "<capturedAt>",
                "category": "optional-signal",
                "details": {
                  "fallback": "loyaltyTier",
                  "signal": "fraudVelocity",
                },
                "domain": "risk",
                "message": "Fraud velocity signal unavailable",
                "name": "Error",
                "stack": "<stack>",
              },
              {
                "capturedAt": "<capturedAt>",
                "category": "sla",
                "details": {
                  "service": "manualReviewSla",
                  "timeoutMs": 1500,
                },
                "domain": "operations",
                "message": "Manual review SLA lookup timed out",
                "name": "Error",
                "stack": undefined,
              },
            ],
            "fallbackSignals": [
              "loyaltyTier",
              "requestedRefundUsd",
            ],
            "name": "load-optional-risk-signals",
            "status": "error",
          },
          "caseRows": [
            {
              "caseId": "recover-with-fallback-signals",
              "columns": {
                "fallbackSignals": [
                  "loyaltyTier",
                  "requestedRefundUsd",
                ],
                "response": "Recovered risk review for order #771 with fallback signals.",
              },
              "status": "pass",
            },
            {
              "caseId": "recover-after-webhook-error",
              "columns": {
                "response": "Queued a retry for order #884 after webhook rejection.",
                "spanError": "Refund webhook rejected #884",
                "submitStatus": "queued-for-retry",
              },
              "status": "pass",
            },
          ],
          "erroredSpan": {
            "error": {
              "message": "Refund webhook rejected #884",
              "name": "Error",
              "stack": "<stack>",
            },
            "errors": undefined,
            "name": "submit-refund-webhook",
            "status": "error",
          },
          "summary": {
            "cancelledCases": 0,
            "errorCases": 0,
            "errorMessage": null,
            "failedCases": 0,
            "passedCases": 2,
            "runId": "<run-id>",
            "status": "completed",
            "totalCases": 2,
            "totalDurationMs": "<totalDurationMs>",
          },
        }
      `);
    });
  });
});

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
