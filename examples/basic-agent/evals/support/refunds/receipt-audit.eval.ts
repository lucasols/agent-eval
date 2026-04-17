import { defineEval } from '@agent-evals/sdk';
import {
  refundWorkflowSharedConfig,
  type WorkflowInput,
} from '../../../src/evals/refundWorkflowSharedConfig.ts';

defineEval<WorkflowInput>({
  id: 'receipt-audit',
  title: 'Receipt Audit',
  description: 'Exercises receipt-heavy refund reviews for support queues',
  cases: [
    {
      id: 'damaged-mug',
      input: {
        message: 'Please refund the chipped mug from order #A-18',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
    {
      id: 'missing-attachment',
      input: {
        message: 'Refund the missing grinder attachment from my bundle order',
        locale: 'en-US',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
  ],
  ...refundWorkflowSharedConfig,
});
