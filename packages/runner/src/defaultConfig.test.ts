import { describe, expect, test } from 'vitest';
import { mergeDefaultColumns } from './defaultConfig.ts';

describe('default config columns', () => {
  test('orders authored columns before missing default usage columns', () => {
    const columns = mergeDefaultColumns({
      globalColumns: {
        globalMetric: { label: 'Global Metric', format: 'number' },
      },
      columns: {
        finalPdf: { label: 'Final PDF', format: 'pdf' },
        pdfSizeBytes: { label: 'PDF bytes', format: 'number' },
        costUsd: {
          label: 'Custom Cost',
          numberFormat: {
            prefix: 'USD ',
            minDecimalPlaces: 2,
            maxDecimalPlaces: 2,
          },
        },
      },
      globalRemove: undefined,
      evalRemove: ['reasoningTokens'],
    });

    expect(Object.keys(columns ?? {})).toEqual([
      'globalMetric',
      'finalPdf',
      'pdfSizeBytes',
      'costUsd',
      'apiCalls',
      'costUsdWithoutCache',
      'costUsdWarmedCache',
      'llmTurns',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'cachedInputTokens',
      'cacheCreationInputTokens',
      'llmDurationMs',
    ]);
    expect(columns?.costUsd).toEqual({
      label: 'Custom Cost',
      format: 'number',
      numberFormat: {
        prefix: 'USD ',
        minDecimalPlaces: 2,
        maxDecimalPlaces: 2,
      },
      hideInTable: undefined,
      hideIfNoValue: true,
      align: 'right',
      maxStars: undefined,
    });
  });
});
