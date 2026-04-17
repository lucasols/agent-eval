import { defineEval } from '@agent-evals/sdk';
import {
  refundWorkflowSharedConfig,
  type WorkflowInput,
} from '../../../src/evals/refundWorkflowSharedConfig.ts';

defineEval<WorkflowInput>({
  id: 'voice-return-follow-up',
  title: 'Voice Return Follow-up',
  description: 'Adds voice-note return requests so the example tree has another branch',
  cases: [
    {
      id: 'wrong-size-jacket',
      input: {
        message: 'I need a refund for the wrong size jacket',
        voiceNote: 'evals/datasets/assets/note-1.mp3',
      },
    },
    {
      id: 'pt-br-defect',
      input: {
        message: 'Preciso de reembolso do pedido com defeito',
        locale: 'pt-BR',
        voiceNote: 'evals/datasets/assets/note-1.mp3',
      },
    },
  ],
  ...refundWorkflowSharedConfig,
});
