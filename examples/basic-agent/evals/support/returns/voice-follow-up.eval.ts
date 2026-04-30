import { defineEval } from '@ls-stack/agent-eval';
import {
  getTraceCounts,
  sharedTraceDisplay,
} from '../../../src/evals/exampleEvalUtils.ts';
import {
  runVoiceReturnFollowUpWorkflow,
  type VoiceReturnFollowUpInput,
} from '../../../src/workflows/voiceReturnFollowUpWorkflow.ts';

defineEval<VoiceReturnFollowUpInput>({
  id: 'voice-return-follow-up',
  title: 'Voice Return Follow-up',
  cases: [
    {
      id: 'wrong-size-jacket',
      input: {
        customerMessage:
          'The jacket is the wrong size and I want return instructions.',
        orderId: '#RET-31',
        preferredChannel: 'email',
        voiceNote: 'evals/datasets/assets/note-1.mp3',
      },
    },
    {
      id: 'pt-br-defect',
      input: {
        customerMessage:
          'Preciso das instrucoes de devolucao do pedido com defeito.',
        locale: 'pt-BR',
        orderId: '#RET-44',
        preferredChannel: 'sms',
        voiceNote: 'evals/datasets/assets/note-1.mp3',
      },
    },
  ],
  columns: {
    response: { label: 'Follow-up', format: 'markdown' },
    detectedLocale: { label: 'Locale' },
    followUpChannel: { label: 'Channel' },
    costUsd: {
      label: 'Cost',
      format: 'number',
      numberFormat: { prefix: '$', minDecimalPlaces: 4, maxDecimalPlaces: 4 },
    },
    toolCalls: { label: 'Tool Calls' },
    llmTurns: { label: 'LLM Turns' },
  },
  traceDisplay: sharedTraceDisplay,
  execute: async ({ input }) => {
    await runVoiceReturnFollowUpWorkflow(input);
  },
  deriveFromTracing: ({ trace }) => getTraceCounts(trace),
  scores: {
    followUpPrepared: {
      label: 'Follow-up Prepared',
      passThreshold: 1,
      compute: ({ outputs }) =>
        outputs.followUpChannel === 'email' || outputs.followUpChannel === 'sms'
          ? 1
          : 0,
    },
  },
});
