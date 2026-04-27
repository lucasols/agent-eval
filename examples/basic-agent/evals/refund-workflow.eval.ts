import { defineEval } from '@ls-stack/agent-eval';
import {
  refundWorkflowSharedConfig,
  type RefundWorkflowOutputs,
  type WorkflowInput,
} from '../src/evals/refundWorkflowSharedConfig.ts';

defineEval<WorkflowInput, RefundWorkflowOutputs>({
  id: 'refund-workflow',
  title: 'Refund Workflow',
  cases: [
    {
      id: 'simple-text',
      input: { message: 'I want a refund for order #123', locale: 'en-US' },
    },
    {
      id: 'with-image',
      input: {
        message: 'Please refund this damaged item',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
    {
      id: 'with-audio',
      input: {
        message: 'I need to return this product',
        voiceNote: 'evals/datasets/assets/note-1.mp3',
      },
    },
  ],
  ...refundWorkflowSharedConfig,
});
