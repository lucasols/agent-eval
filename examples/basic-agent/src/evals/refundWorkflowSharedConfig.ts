import { matchesEvalTags, z, type EvalDefinition } from '@ls-stack/agent-eval';
import {
  triggerWorkflow,
  type WorkflowInput,
} from '../workflows/triggerWorkflow.ts';

export type { WorkflowInput } from '../workflows/triggerWorkflow.ts';

const REFUND_REGEX = /refund/i;
const USD_TO_BRL = 5.7;

const refundWorkflowOutputsSchema = z.object({
  response: z.string(),
  costUsd: z.number(),
  toolCalls: z.number(),
  llmTurns: z.number(),
  tagContext: z.string().optional(),
});

export type RefundWorkflowOutputs = z.infer<typeof refundWorkflowOutputsSchema>;

function sampleReviewConfidence(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 10_000;
  }

  // Keep example scores varied without making test runs flaky.
  return Math.round((0.6 + (hash / 10_000) * 0.39) * 100) / 100;
}

export const refundWorkflowSharedConfig: Pick<
  EvalDefinition<WorkflowInput, RefundWorkflowOutputs>,
  'outputsSchema' | 'columns' | 'traceDisplay' | 'stats' | 'execute' | 'scores'
> = {
  outputsSchema: refundWorkflowOutputsSchema,
  columns: {
    response: { label: 'Response', format: 'markdown' },
    reviewConfidence: { label: 'Review Confidence' },
    tagContext: { label: 'Tag Context' },
  },
  stats: [
    { kind: 'cases' },
    { kind: 'passRate', accent: true },
    {
      kind: 'column',
      key: 'reviewConfidence',
      label: 'Review Confidence',
      aggregate: 'avg',
      numberFormat: { minDecimalPlaces: 2, maxDecimalPlaces: 2 },
    },
    { kind: 'duration' },
  ],
  traceDisplay: {
    attributes: [
      { path: 'model', label: 'Model', placements: ['detail'] },
      {
        path: 'usage.inputTokens',
        label: 'Input tokens',
        format: 'number',
        placements: ['detail'],
      },
      {
        path: 'usage.outputTokens',
        label: 'Output tokens',
        format: 'number',
        placements: ['detail'],
      },
      {
        path: 'costUsd',
        label: 'Cost',
        format: 'number',
        numberFormat: { prefix: '$', minDecimalPlaces: 4, maxDecimalPlaces: 4 },
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
  execute: async ({ input, setOutput }) => {
    if (matchesEvalTags({ any: ['media'] })) {
      setOutput('tagContext', 'media-case');
    }
    await triggerWorkflow(input);
  },
  scores: {
    mentionsRefund: {
      label: 'Mentions Refund',
      passThreshold: 1,
      compute: ({ outputs }) => {
        return REFUND_REGEX.test(outputs.response) ? 1 : 0;
      },
    },
    reviewConfidence: {
      label: 'Review Confidence',
      passThreshold: 0.6,
      compute: ({ case: evalCase }) => {
        return sampleReviewConfidence(evalCase.id);
      },
    },
  },
};
