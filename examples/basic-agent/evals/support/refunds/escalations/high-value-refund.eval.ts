import { defineEval } from '@agent-evals/sdk';
import {
  getTraceCounts,
  sharedTraceDisplay,
} from '../../../../src/evals/exampleEvalUtils.ts';
import {
  runHighValueRefundWorkflow,
  type HighValueRefundInput,
} from '../../../../src/workflows/highValueRefundWorkflow.ts';

defineEval<HighValueRefundInput>({
  id: 'high-value-refund',
  title: 'High Value Refund',
  description: 'Covers premium purchase refund escalations in a deeper folder',
  cases: [
    {
      id: 'espresso-machine',
      input: {
        customerMessage: 'The premium espresso machine leaked on first use.',
        loyaltyTier: 'vip',
        orderId: '#9001',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
        requestedRefundUsd: 1299,
      },
    },
  ],
  columns: {
    response: { label: 'Decision', primary: true },
    escalationQueue: { label: 'Escalation Queue' },
    riskLevel: { label: 'Risk Level' },
    costUsd: { label: 'Cost', format: 'usd' },
    toolCalls: { label: 'Tool Calls' },
    llmTurns: { label: 'LLM Turns' },
  },
  traceDisplay: sharedTraceDisplay,
  execute: async ({ input }) => {
    await runHighValueRefundWorkflow(input);
  },
  deriveFromTracing: ({ trace }) => getTraceCounts(trace),
  scores: {
    financeEscalated: {
      label: 'Finance Escalated',
      passThreshold: 1,
      compute: ({ outputs }) =>
        outputs.escalationQueue === 'finance-review' ? 1 : 0,
    },
  },
  passThreshold: 0.5,
});
