import { defineEval } from '@agent-evals/sdk';
import {
  refundWorkflowSharedConfig,
  type WorkflowInput,
} from '../../../../src/evals/refundWorkflowSharedConfig.ts';

defineEval<WorkflowInput>({
  id: 'high-value-refund',
  title: 'High Value Refund',
  description: 'Covers premium purchase refund escalations in a deeper folder',
  cases: [
    {
      id: 'espresso-machine',
      input: {
        message: 'Refund the damaged espresso machine from order #9001',
        locale: 'en-US',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
  ],
  ...refundWorkflowSharedConfig,
});
