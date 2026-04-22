import type { ColumnDef, EvalChartsConfig } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import { validateCharts } from '../../runner/src/chartValidation.ts';

const columnDefs: ColumnDef[] = [
  { key: 'response', label: 'Response', kind: 'string', format: 'markdown' },
  {
    key: 'score',
    label: 'Score',
    kind: 'number',
    isScore: true,
    passThreshold: 0.5,
  },
  { key: 'infoScore', label: 'Info Score', kind: 'number', isScore: true },
];

describe('validateCharts', () => {
  test('returns undefined when charts is undefined', () => {
    const result = validateCharts({
      charts: undefined,
      columnDefs,
      evalId: 'demo',
    });
    expect(result.charts).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  test('returns undefined when charts is empty', () => {
    const result = validateCharts({ charts: [], columnDefs, evalId: 'demo' });
    expect(result.charts).toBeUndefined();
  });

  test('keeps valid builtin metrics', () => {
    const charts: EvalChartsConfig = [
      { type: 'area', metrics: [{ source: 'builtin', metric: 'passRate' }] },
    ];
    const result = validateCharts({ charts, columnDefs, evalId: 'demo' });
    expect(result.charts).toEqual(charts);
    expect(result.warnings).toEqual([]);
  });

  test('drops unknown column metrics and warns', () => {
    const charts: EvalChartsConfig = [
      {
        type: 'line',
        metrics: [
          { source: 'builtin', metric: 'passRate' },
          { source: 'column', key: 'missing', aggregate: 'avg' },
        ],
      },
    ];
    const result = validateCharts({ charts, columnDefs, evalId: 'demo' });
    expect(result.charts).toHaveLength(1);
    expect(result.charts?.[0]?.metrics).toHaveLength(1);
    expect(result.warnings[0]).toContain('unknown column "missing"');
  });

  test('drops passThresholdRate on a score without passThreshold', () => {
    const charts: EvalChartsConfig = [
      {
        type: 'bar',
        metrics: [
          {
            source: 'column',
            key: 'infoScore',
            aggregate: 'passThresholdRate',
          },
        ],
      },
    ];
    const result = validateCharts({ charts, columnDefs, evalId: 'demo' });
    expect(result.charts).toBeUndefined();
    expect(result.warnings[0]).toContain('passThresholdRate');
  });

  test('keeps passThresholdRate on a valid score column', () => {
    const charts: EvalChartsConfig = [
      {
        type: 'bar',
        metrics: [
          { source: 'column', key: 'score', aggregate: 'passThresholdRate' },
        ],
      },
    ];
    const result = validateCharts({ charts, columnDefs, evalId: 'demo' });
    expect(result.charts).toEqual(charts);
  });

  test('drops whole chart when all metrics invalid but keeps other charts', () => {
    const charts: EvalChartsConfig = [
      {
        type: 'line',
        metrics: [{ source: 'column', key: 'missing', aggregate: 'avg' }],
      },
      { type: 'area', metrics: [{ source: 'builtin', metric: 'cost' }] },
    ];
    const result = validateCharts({ charts, columnDefs, evalId: 'demo' });
    expect(result.charts).toHaveLength(1);
    expect(result.charts?.[0]?.type).toBe('area');
  });

  test('filters tooltip extras that reference unknown columns', () => {
    const charts: EvalChartsConfig = [
      {
        type: 'line',
        metrics: [{ source: 'builtin', metric: 'passRate' }],
        tooltipExtras: [
          { source: 'column', key: 'missing', aggregate: 'avg' },
          { source: 'column', key: 'score', aggregate: 'avg' },
        ],
      },
    ];
    const result = validateCharts({ charts, columnDefs, evalId: 'demo' });
    expect(result.charts?.[0]?.tooltipExtras).toHaveLength(1);
    expect(result.charts?.[0]?.tooltipExtras?.[0]).toMatchObject({
      source: 'column',
      key: 'score',
    });
  });
});
