import type { EvalDefinition, EvalTraceTree } from '@agent-evals/sdk';

const USD_TO_BRL = 5.7;

export function isTextBlock(
  value: unknown,
): value is { kind: 'text' | 'markdown'; text: string } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('kind' in value) || !('text' in value)) return false;
  return (
    (value.kind === 'text' || value.kind === 'markdown') &&
    typeof value.text === 'string'
  );
}

export function getResponseText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter(isTextBlock)
    .map((block) => block.text)
    .join(' ');
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
};
