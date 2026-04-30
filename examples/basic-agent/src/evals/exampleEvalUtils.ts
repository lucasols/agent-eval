import type { EvalDefinition, EvalTraceTree } from '@ls-stack/agent-eval';

const USD_TO_BRL = 5.7;

export function getResponseText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function getTraceCounts(trace: EvalTraceTree): {
  llmTurns: number;
  toolCalls: number;
} {
  return {
    toolCalls: trace.findSpansByKind('tool').length,
    llmTurns: trace.findSpansByKind('llm').length,
  };
}

export const sharedTraceDisplay: NonNullable<
  EvalDefinition<unknown>['traceDisplay']
> = {
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
};
