import { defineEval } from '@ls-stack/agent-eval';
import { sharedTraceDisplay } from '../../../../src/evals/exampleEvalUtils.ts';
import {
  runHighValueRefundWorkflow,
  type HighValueRefundInput,
} from '../../../../src/workflows/highValueRefundWorkflow.ts';

defineEval<HighValueRefundInput>({
  id: 'high-value-refund',
  title: 'High Value Refund',
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
    response: { label: 'Decision', format: 'markdown' },
    escalationQueue: { label: 'Escalation Queue' },
    riskLevel: { label: 'Risk Level' },
    costUsd: {
      label: 'Cost',
      format: 'number',
      numberFormat: { prefix: '$', minDecimalPlaces: 4, maxDecimalPlaces: 4 },
    },
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
