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
      expect(result.stdout).toContain('Voice Return Follow-up');
      expect(result.stdout).toContain('Refund Workflow');
      expect(result.stdout).toContain('refund-workflow');
      expect(
        normalizeTextSnapshot(workspacePath, result.stdout),
      ).toMatchInlineSnapshot(`
        "Discovered evals:

          Refund Workflow
            id: refund-workflow
            file: <workspace>/evals/refund-workflow.eval.ts

          Voice Return Follow-up
            id: voice-return-follow-up
            file: <workspace>/evals/support/returns/voice-follow-up.eval.ts

          Receipt Audit
            id: receipt-audit
            file: <workspace>/evals/support/refunds/receipt-audit.eval.ts

          High Value Refund
            id: high-value-refund
            file: <workspace>/evals/support/refunds/escalations/high-value-refund.eval.ts"
      `);
    });
  });
});
