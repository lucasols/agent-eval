import { describe, expect, test } from 'vitest';
import {
  normalizeTextSnapshot,
  runExampleCli,
  withIsolatedExampleWorkspace,
} from './cliTestUtils.ts';

describe('CLI discovery', () => {
  test('lists evals from the example workspace', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      const result = await runExampleCli(workspacePath, ['list']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('High Value Refund');
      expect(result.stdout).toContain('high-value-refund');
      expect(result.stdout).toContain('Receipt Audit');
      expect(result.stdout).toContain('Receipt Fraud Review');
      expect(result.stdout).toContain('Score Threshold Demo');
      expect(result.stdout).toContain('Assertion Failure Demo');
      expect(result.stdout).toContain('Silent Pass Demo');
      expect(result.stdout).toContain('Silent Assertion Demo');
      expect(result.stdout).toContain('Randomized Lab');
      expect(result.stdout).toContain('Voice Return Follow-up');
      expect(result.stdout).toContain('Refund Workflow');
      expect(result.stdout).toContain('refund-workflow');
      expect(
        normalizeTextSnapshot(workspacePath, result.stdout),
      ).toMatchInlineSnapshot(`
        "Discovered evals:

          Refund Workflow
            id: refund-workflow
            file: evals/refund-workflow.eval.ts

          Randomized Lab
            id: randomized-lab
            file: evals/support/playground/randomized-lab.eval.ts

          Score Threshold Demo
            id: score-threshold-demo
            file: evals/support/quality/outcome-behavior.eval.ts

          Assertion Failure Demo
            id: assertion-failure-demo
            file: evals/support/quality/outcome-behavior.eval.ts

          Silent Pass Demo
            id: silent-pass-demo
            file: evals/support/quality/outcome-behavior.eval.ts

          Silent Assertion Demo
            id: silent-assertion-demo
            file: evals/support/quality/outcome-behavior.eval.ts

          High Value Refund
            id: high-value-refund
            file: evals/support/refunds/escalations/high-value-refund.eval.ts

          Receipt Audit
            id: receipt-audit
            file: evals/support/refunds/receipt-audit.eval.ts

          Receipt Fraud Review
            id: receipt-fraud-review
            file: evals/support/refunds/receipt-audit.eval.ts

          Voice Return Follow-up
            id: voice-return-follow-up
            file: evals/support/returns/voice-follow-up.eval.ts"
      `);
    });
  });
});
