import type { EvalTraceSpan } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  normalizeSnapshotValue,
  readSingleRunArtifacts,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI span diagnostic examples', () => {
  test('persists span diagnostics and diagnostic output keys from example evals', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, [
        'run',
        '--eval',
        'captured-span-errors-demo,warning-span-demo,errored-span-demo,diagnostic-output-keys-demo',
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
      const warningTrace = requireTrace(
        artifacts.traces,
        'continue-with-stale-signal.json',
      );
      const warningSpan = requireSpan(warningTrace, 'load-sla-signal');
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
      expect(warningSpan.status).toBe('ok');
      expect(warningSpan.error).toBeUndefined();
      expect(warningSpan.errors).toBeUndefined();
      expect(warningSpan.warning).toMatchObject({
        category: 'staleness',
        details: { maxAgeMinutes: 10, observedAgeMinutes: 18 },
        domain: 'operations',
        name: 'SignalFreshnessWarning',
        message: 'Manual review SLA signal is stale',
      });
      expect(warningSpan.warnings).toMatchObject([
        {
          category: 'staleness',
          details: { maxAgeMinutes: 10, observedAgeMinutes: 18 },
          domain: 'operations',
          name: 'SignalFreshnessWarning',
          message: 'Manual review SLA signal is stale',
        },
      ]);
      for (const warning of warningSpan.warnings ?? []) {
        expect(typeof warning.capturedAt).toBe('string');
        expect(Number.isNaN(Date.parse(warning.capturedAt ?? ''))).toBe(false);
      }
      expect(erroredSpan.status).toBe('error');
      expect(erroredSpan.error).toMatchObject({
        name: 'Error',
        message: 'Refund webhook rejected #884',
      });
      expect(erroredSpan.errors).toBeUndefined();

      expect(
        normalizeSnapshotValue(workspacePath, {
          summary: artifacts.summary,
          caseRows: artifacts.cases
            .toSorted(
              (left, right) =>
                getDiagnosticCaseOrder(left.caseId) -
                getDiagnosticCaseOrder(right.caseId),
            )
            .map((caseRow) => ({
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
          warningSpan: {
            name: warningSpan.name,
            status: warningSpan.status,
            warning: warningSpan.warning
              ? {
                  category: warningSpan.warning.category,
                  details: warningSpan.warning.details,
                  domain: warningSpan.warning.domain,
                  name: warningSpan.warning.name,
                  message: warningSpan.warning.message,
                  stack: warningSpan.warning.stack ? '<stack>' : undefined,
                  capturedAt: warningSpan.warning.capturedAt
                    ? '<capturedAt>'
                    : undefined,
                }
              : undefined,
            warnings: warningSpan.warnings?.map((warning) => ({
              category: warning.category,
              details: warning.details,
              domain: warning.domain,
              name: warning.name,
              message: warning.message,
              stack: warning.stack ? '<stack>' : undefined,
              capturedAt: warning.capturedAt ? '<capturedAt>' : undefined,
            })),
            errors: warningSpan.errors,
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
                "llmTurns": 0,
                "response": "Recovered risk review for order #771 with fallback signals.",
                "toolCalls": 1,
              },
              "status": "pass",
            },
            {
              "caseId": "continue-with-stale-signal",
              "columns": {
                "llmTurns": 0,
                "response": "Continued review for order #662 with a stale SLA signal.",
                "signalFreshness": "stale",
                "toolCalls": 1,
              },
              "status": "pass",
            },
            {
              "caseId": "recover-after-webhook-error",
              "columns": {
                "llmTurns": 0,
                "response": "Queued a retry for order #884 after webhook rejection.",
                "spanError": "Refund webhook rejected #884",
                "submitStatus": "queued-for-retry",
                "toolCalls": 1,
              },
              "status": "pass",
            },
            {
              "caseId": "review-diagnostic-output-keys",
              "columns": {
                "diagnosticSummary": {
                  "errorCount": 0,
                  "nextAction": "watch-for-carrier-callback",
                  "warning": "Carrier refund status is delayed",
                },
                "llmTurns": 0,
                "response": "Recorded diagnostic output keys for order #935.",
                "retryFailures": [
                  {
                    "reason": "status-not-ready",
                    "service": "carrier-refund-status",
                  },
                ],
                "toolCalls": 0,
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
            "cacheHits": 0,
            "cacheOperations": 0,
            "cancelledCases": 0,
            "errorCases": 0,
            "errorMessage": null,
            "failedCases": 0,
            "llmCacheHits": 0,
            "llmCalls": 0,
            "llmCallsMade": 0,
            "passedCases": 4,
            "runId": "<run-id>",
            "status": "completed",
            "totalCases": 4,
            "totalDurationMs": "<totalDurationMs>",
          },
          "warningSpan": {
            "errors": undefined,
            "name": "load-sla-signal",
            "status": "ok",
            "warning": {
              "capturedAt": "<capturedAt>",
              "category": "staleness",
              "details": {
                "maxAgeMinutes": 10,
                "observedAgeMinutes": 18,
              },
              "domain": "operations",
              "message": "Manual review SLA signal is stale",
              "name": "SignalFreshnessWarning",
              "stack": undefined,
            },
            "warnings": [
              {
                "capturedAt": "<capturedAt>",
                "category": "staleness",
                "details": {
                  "maxAgeMinutes": 10,
                  "observedAgeMinutes": 18,
                },
                "domain": "operations",
                "message": "Manual review SLA signal is stale",
                "name": "SignalFreshnessWarning",
                "stack": undefined,
              },
            ],
          },
        }
      `);
    });
  });
});

function getDiagnosticCaseOrder(caseId: string): number {
  const order = [
    'recover-with-fallback-signals',
    'continue-with-stale-signal',
    'recover-after-webhook-error',
    'review-diagnostic-output-keys',
  ].indexOf(caseId);
  return order === -1 ? Number.MAX_SAFE_INTEGER : order;
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
