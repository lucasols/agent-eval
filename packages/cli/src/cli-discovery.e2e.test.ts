import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  normalizeTextSnapshot,
  runExampleCli,
  runWorkspaceCommand,
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
      expect(result.stdout).toContain('Module Mock Demo');
      expect(result.stdout).toContain('Format Gallery');
      expect(result.stdout).toContain('Randomized Lab');
      expect(result.stdout).toContain('Voice Return Follow-up');
      expect(result.stdout).toContain('Refund Workflow');
      expect(result.stdout).toContain('refund-workflow');
      expect(normalizeTextSnapshot(workspacePath, result.stdout))
        .toMatchInlineSnapshot(`
        "Discovered evals:

          Refund Workflow
            id: refund-workflow
            file: evals/refund-workflow.eval.ts

          Format Gallery
            id: format-gallery
            file: evals/support/playground/format-gallery.eval.ts

          Module Mock Demo
            id: module-mock-demo
            file: evals/support/playground/module-mock.eval.ts

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

  test('shows outdated freshness when the latest run is old and from another commit', async () => {
    await withIsolatedExampleWorkspace(async (workspacePath) => {
      expect(
        (await runWorkspaceCommand(workspacePath, 'git', ['init'])).exitCode,
      ).toBe(0);
      expect(
        (
          await runWorkspaceCommand(workspacePath, 'git', [
            'config',
            'user.email',
            'ci@example.com',
          ])
        ).exitCode,
      ).toBe(0);
      expect(
        (
          await runWorkspaceCommand(workspacePath, 'git', [
            'config',
            'user.name',
            'CI',
          ])
        ).exitCode,
      ).toBe(0);
      expect(
        (await runWorkspaceCommand(workspacePath, 'git', ['add', '.']))
          .exitCode,
      ).toBe(0);
      expect(
        (
          await runWorkspaceCommand(workspacePath, 'git', [
            'commit',
            '-m',
            'initial',
          ])
        ).exitCode,
      ).toBe(0);

      const runPath = join(
        workspacePath,
        '.agent-evals',
        'runs',
        '2026-04-01T12-00-00Z_outdated',
      );
      await mkdir(join(runPath, 'case-details'), { recursive: true });
      await writeFile(
        join(runPath, 'run.json'),
        JSON.stringify(
          {
            id: '2026-04-01T12-00-00Z_outdated',
            shortId: 'r0',
            status: 'completed',
            startedAt: '2026-04-01T12:00:00.000Z',
            endedAt: '2026-04-01T12:00:02.000Z',
            commitSha: '1111111111111111111111111111111111111111',
            target: { mode: 'evalIds', evalIds: ['refund-workflow'] },
            trials: 1,
            trialSelection: 'lowestScore',
            cacheMode: 'use',
          },
          null,
          2,
        ),
      );
      await writeFile(
        join(runPath, 'summary.json'),
        JSON.stringify(
          {
            runId: '2026-04-01T12-00-00Z_outdated',
            status: 'completed',
            totalCases: 1,
            passedCases: 1,
            failedCases: 0,
            errorCases: 0,
            cancelledCases: 0,
            totalDurationMs: 2000,
            errorMessage: null,
          },
          null,
          2,
        ),
      );
      await writeFile(
        join(runPath, 'cases.jsonl'),
        `${JSON.stringify({
          caseId: 'simple-text',
          evalId: 'refund-workflow',
          status: 'pass',
          latencyMs: 120,
          costUsd: 0.01,
          columns: {},
          trial: 0,
        })}
`,
      );

      const result = await runExampleCli(workspacePath, ['list']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Refund Workflow');
      expect(result.stdout).toContain('status: outdated');
    });
  });
});
