import { defineEval, evalExpect, setEvalOutput } from '@ls-stack/agent-eval';
import {
  mockCaseIsolationBackend,
  runCaseIsolationWorkflow,
  type CaseIsolationBackendMode,
} from '../../../src/workflows/caseIsolationWorkflow.ts';

defineEval<{
  mode: CaseIsolationBackendMode;
  request: string;
  delayMs: number;
}>({
  id: 'case-isolation-demo',
  title: 'Case Isolation Demo',
  tags: ['playground'],
  cases: [
    {
      id: 'slow-approval-backend',
      input: {
        mode: 'approval',
        request: 'Approve the duplicate-charge refund',
        delayMs: 120,
      },
    },
    {
      id: 'fast-review-backend',
      input: {
        mode: 'manual-review',
        request: 'Send the borderline refund to manual review',
        delayMs: 10,
      },
    },
  ],
  columns: {
    backendMode: { label: 'Backend Mode' },
    response: { label: 'Response', format: 'markdown' },
  },
  execute: async ({ input }) => {
    mockCaseIsolationBackend(input.mode);
    const result = await runCaseIsolationWorkflow(input);

    setEvalOutput('backendMode', result.mode);
    setEvalOutput('response', result.response);

    evalExpect(result.mode).toBe(input.mode);
  },
  scores: {
    usedExpectedBackend: {
      label: 'Used Expected Backend',
      passThreshold: 1,
      compute: ({ input, outputs }) =>
        outputs.backendMode === input.mode ? 1 : 0,
    },
  },
});
