import { defineEval } from '@agent-evals/sdk';
import {
  triggerWorkflow,
  type WorkflowInput,
} from '../src/workflows/triggerWorkflow.ts';

const REFUND_REGEX = /refund/i;
const USD_TO_BRL = 5.7;

function isTextBlock(
  value: unknown,
): value is { kind: 'text' | 'markdown'; text: string } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('kind' in value) || !('text' in value)) return false;
  return (
    (value.kind === 'text' || value.kind === 'markdown') &&
    typeof value.text === 'string'
  );
}

defineEval<WorkflowInput>({
  id: 'refund-workflow',
  title: 'Refund Workflow',
  description: 'Runs the refund workflow end-to-end',
  cases: [
    {
      id: 'simple-text',
      input: {
        message: 'I want a refund for order #123',
        locale: 'en-US',
      },
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
  columns: {
    response: { label: 'Response', primary: true },
    costUsd: { label: 'Cost', format: 'usd' },
    toolCalls: { label: 'Tool Calls' },
    llmTurns: { label: 'LLM Turns' },
  },
  traceDisplay: {
    attributes: [
      { path: 'model', label: 'Model', placements: ['detail'] },
      { path: 'usage.inputTokens', label: 'Input tokens', format: 'number', placements: ['detail'] },
      { path: 'usage.outputTokens', label: 'Output tokens', format: 'number', placements: ['detail'] },
      {
        path: 'costUsd',
        label: 'Cost',
        format: 'usd',
        placements: ['tree', 'detail'],
        scope: 'subtree',
        mode: 'sum',
      },
      {
        key: 'costBrl',
        path: 'costUsd',
        label: 'Cost (BRL)',
        placements: ['detail'],
        scope: 'subtree',
        mode: 'sum',
        transform: ({ value }) =>
          typeof value === 'number'
            ? new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(value * USD_TO_BRL)
            : value,
      },
    ],
  },
  execute: async ({ input }) => {
    await triggerWorkflow(input);
  },
  deriveFromTracing: ({ trace }) => ({
    toolCalls: trace.findSpansByKind('tool').length,
    llmTurns: trace.findSpansByKind('llm').length,
  }),
  scores: {
    mentionsRefund: {
      label: 'Mentions Refund',
      passThreshold: 1,
      compute: ({ outputs }) => {
        const response = outputs.response;
        if (!Array.isArray(response)) return 0;
        const text = response
          .filter(isTextBlock)
          .map((b) => b.text)
          .join(' ');
        return REFUND_REGEX.test(text) ? 1 : 0;
      },
    },
  },
  passThreshold: 0.5,
});
