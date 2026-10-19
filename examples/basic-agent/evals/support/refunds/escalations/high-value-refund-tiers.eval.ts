import { defineEval } from '@ls-stack/agent-eval';
import { sharedTraceDisplay } from '../../../../src/evals/exampleEvalUtils.ts';
import {
  runHighValueRefundWorkflow,
  type HighValueRefundInput,
} from '../../../../src/workflows/highValueRefundWorkflow.ts';

defineEval<HighValueRefundInput>({
  id: 'high-value-refund-tiers',
  title: 'High Value Refund by Tier',
  description:
    'Tracks finance escalation of high value refunds separately for each loyalty tier, so a regression for one tier is visible on its own eval.',
  casesAsEvals: true,
  cases: [
    {
      id: 'standard-laptop',
      input: {
        customerMessage: 'The laptop screen cracked a week after delivery.',
        loyaltyTier: 'standard',
        orderId: '#9102',
        receiptImage: 'evals/datasets/assets/receipt-2.png',
        requestedRefundUsd: 1899,
      },
    },
    {
      id: 'vip-espresso-machine',
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
    response: { label: 'Decision', format: 'markdown' },
    escalationQueue: { label: 'Escalation Queue' },
  },
  traceDisplay: sharedTraceDisplay,
  execute: async ({ input }) => {
    await runHighValueRefundWorkflow(input);
  },
  scores: {
    financeEscalated: {
      label: 'Finance Escalated',
      passThreshold: 1,
      compute: ({ outputs }) =>
        outputs.escalationQueue === 'finance-review' ? 1 : 0,
    },
  },
});
