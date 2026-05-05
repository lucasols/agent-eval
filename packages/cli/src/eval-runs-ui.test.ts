import type {
  CaseRow,
  ColumnDef,
  EvalChartConfig,
  RunManifest,
} from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import { buildChartPoints } from '../../../apps/web/src/utils/chartData.ts';
import { chartHasNumericValue } from '../../../apps/web/src/utils/chartVisibility.ts';
import {
  buildEvalDebugCliCommand,
  buildEvalRunCliCommand,
} from '../../../apps/web/src/utils/cliCommand.ts';
import { getVisibleRunTableColumns } from '../../../apps/web/src/utils/columnVisibility.ts';
import {
  buildEvalScopedRunRows,
  scopeRunCases,
  type ScopedRunRow,
} from '../../../apps/web/src/utils/evalRuns.ts';
import { mergeRunRuntimeColumnDefs } from '../../../apps/web/src/utils/runtimeColumnDefs.ts';
import { shouldShowStatDisplay } from '../../../apps/web/src/utils/statVisibility.ts';

function createScopedRun(params: {
  id: string;
  quality: number | null;
  cost: number | null;
}): ScopedRunRow {
  const columns: CaseRow['columns'] = {};
  if (params.quality !== null) columns.quality = params.quality;
  if (params.cost !== null) columns.costUsd = params.cost;

  return {
    manifest: {
      id: params.id,
      shortId: `r${params.id}`,
      status: 'completed',
      startedAt: `2026-04-21T12:00:0${params.id}.000Z`,
      endedAt: `2026-04-21T12:00:1${params.id}.000Z`,
      commitSha: null,
      evalSourceFingerprints: {},
      target: { mode: 'all' },
      trials: 1,
      trialSelection: 'lowestScore',
      cacheMode: 'use',
    },
    summary: {
      status: 'pass',
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      errorCases: 0,
      cancelledCases: 0,
      runningCases: 0,
      pendingCases: 0,
      totalDurationMs: 1,
    },
    cases: [
      {
        caseId: 'case-1',
        evalId: 'eval-1',
        evalKey: 'eval-1',
        status: 'pass',
        durationMs: 1,
        columns,
        trial: 0,
      },
    ],
  };
}

describe('eval run rows ui', () => {
  test('builds package-manager-specific eval run commands', () => {
    expect(
      buildEvalRunCliCommand({
        packageManager: 'pnpm',
        evalId: 'errored-span-demo',
      }),
    ).toBe('pnpm exec agent-evals run --eval errored-span-demo');
    expect(
      buildEvalRunCliCommand({ packageManager: 'npm', evalId: 'needs quotes' }),
    ).toBe("npm exec agent-evals -- run --eval 'needs quotes'");
  });

  test('builds package-manager-specific eval debug commands', () => {
    expect(
      buildEvalDebugCliCommand({
        packageManager: 'pnpm',
        evalId: 'errored-span-demo',
      }),
    ).toBe('pnpm exec agent-evals run --inspect --eval errored-span-demo');
    expect(
      buildEvalDebugCliCommand({
        packageManager: 'npm',
        evalId: 'needs quotes',
      }),
    ).toBe("npm exec agent-evals -- run --inspect --eval 'needs quotes'");
  });

  test('builds eval-scoped summaries from filtered case rows instead of the whole run', () => {
    const manifest: RunManifest = {
      id: 'run-1',
      shortId: 'r1',
      status: 'completed',
      startedAt: '2026-04-21T12:00:00.000Z',
      endedAt: '2026-04-21T12:00:03.000Z',
      commitSha: null,
      evalSourceFingerprints: {},
      target: { mode: 'all' },
      trials: 1,
      trialSelection: 'lowestScore',
      cacheMode: 'use',
    };
    const cases: CaseRow[] = [
      {
        caseId: 'alpha-pass',
        evalId: 'alpha',
        evalKey: 'evals%2Falpha.eval.ts#alpha',
        status: 'pass',
        durationMs: 120,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'beta-fail',
        evalId: 'beta',
        evalKey: 'evals%2Fbeta.eval.ts#beta',
        status: 'fail',
        durationMs: 260,
        columns: {},
        trial: 0,
      },
    ];

    const [alphaRow] = buildEvalScopedRunRows(
      [{ manifest, cases }],
      'evals%2Falpha.eval.ts#alpha',
    );
    const [betaRow] = buildEvalScopedRunRows(
      [{ manifest, cases }],
      'evals%2Fbeta.eval.ts#beta',
    );

    expect(alphaRow?.summary).toMatchObject({
      status: 'pass',
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      totalDurationMs: 120,
    });
    expect(betaRow?.summary).toMatchObject({
      status: 'fail',
      totalCases: 1,
      passedCases: 0,
      failedCases: 1,
      totalDurationMs: 260,
    });
  });

  test('scopes drawer run data to the selected eval', () => {
    const cases: CaseRow[] = [
      {
        caseId: 'refund-pass',
        evalId: 'high-value-refund',
        evalKey:
          'evals%2Fsupport%2Frefunds%2Fescalations%2Fhigh-value-refund.eval.ts#high-value-refund',
        status: 'pass',
        durationMs: 564,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'other-fail',
        evalId: 'receipt-fraud-review',
        evalKey:
          'evals%2Fsupport%2Frefunds%2Freceipts%2Freceipt-fraud-review.eval.ts#receipt-fraud-review',
        status: 'fail',
        durationMs: 1200,
        columns: {},
        trial: 0,
      },
    ];

    const scoped = scopeRunCases({
      cases,
      evals: [
        {
          id: 'high-value-refund',
          key: 'evals%2Fsupport%2Frefunds%2Fescalations%2Fhigh-value-refund.eval.ts#high-value-refund',
          filePath:
            'evals/support/refunds/escalations/high-value-refund.eval.ts',
        },
        {
          id: 'receipt-fraud-review',
          key: 'evals%2Fsupport%2Frefunds%2Freceipts%2Freceipt-fraud-review.eval.ts#receipt-fraud-review',
          filePath:
            'evals/support/refunds/receipts/receipt-fraud-review.eval.ts',
        },
      ],
      selectedEvalKey:
        'evals%2Fsupport%2Frefunds%2Fescalations%2Fhigh-value-refund.eval.ts#high-value-refund',
      selectedFolderPath: null,
    });

    expect(scoped.label).toBe('high-value-refund');
    expect(scoped.cases).toEqual([
      expect.objectContaining({
        caseId: 'refund-pass',
        evalId: 'high-value-refund',
      }),
    ]);
  });

  test('scopes drawer run data by eval key', () => {
    const cases: CaseRow[] = [
      {
        caseId: 'simple-text',
        evalId: 'refund-workflow',
        evalKey: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
        status: 'pass',
        durationMs: 229,
        columns: {},
        trial: 0,
      },
      {
        caseId: 'other',
        evalId: 'refund-workflow',
        evalKey: 'evals%2Fother-refund.eval.ts#refund-workflow',
        status: 'fail',
        durationMs: 1200,
        columns: {},
        trial: 0,
      },
    ];

    const scoped = scopeRunCases({
      cases,
      evals: [
        {
          id: 'refund-workflow',
          key: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
          filePath: 'evals/refund-workflow.eval.ts',
        },
      ],
      selectedEvalKey: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
      selectedFolderPath: null,
    });

    expect(scoped.label).toBe('refund-workflow');
    expect(scoped.cases).toEqual([
      expect.objectContaining({
        caseId: 'simple-text',
        evalKey: 'evals%2Frefund-workflow.eval.ts#refund-workflow',
      }),
    ]);
  });

  test('hides run table columns with no UI value only when configured', () => {
    const columns: ColumnDef[] = [
      { key: 'missing', label: 'Missing', kind: 'string' },
      { key: 'empty', label: 'Empty', kind: 'string', hideIfNoValue: true },
      { key: 'zero', label: 'Zero', kind: 'number', hideIfNoValue: true },
      {
        key: 'falseValue',
        label: 'False',
        kind: 'boolean',
        hideIfNoValue: true,
      },
      {
        key: 'pendingScore',
        label: 'Pending Score',
        kind: 'number',
        isScore: true,
        hideIfNoValue: true,
      },
      {
        key: 'score',
        label: 'Score',
        kind: 'number',
        isScore: true,
        hideIfNoValue: true,
      },
    ];
    const rows = getVisibleRunTableColumns({
      columnDefs: columns,
      runs: [
        {
          cases: [
            {
              caseId: 'case-1',
              evalId: 'eval-1',
              status: 'pass',
              durationMs: 1,
              columns: {
                missing: null,
                empty: '',
                zero: 0,
                falseValue: false,
                pendingScore: null,
                score: 0,
              },
              trial: 0,
            },
          ],
        },
      ],
    });

    expect(rows.otherCustomColumns.map((column) => column.key)).toEqual([
      'missing',
      'zero',
      'falseValue',
    ]);
    expect(rows.scoreColumns.map((column) => column.key)).toEqual(['score']);
  });

  test('infers unconfigured run table columns from case rows', () => {
    const rows = [
      {
        cases: [
          {
            caseId: 'case-1',
            evalId: 'eval-1',
            status: 'pass' as const,
            durationMs: 1,
            columns: {
              configured: 'ok',
              rawToolEvents: [{ name: 'receipt-match', status: 'passed' }],
            },
            trial: 0,
          },
        ],
      },
    ];

    const columnDefs = mergeRunRuntimeColumnDefs(
      [{ key: 'configured', label: 'Configured', kind: 'string' }],
      rows,
    );
    const visible = getVisibleRunTableColumns({ columnDefs, runs: rows });

    expect(visible.otherCustomColumns).toMatchObject([
      { key: 'configured', label: 'Configured', kind: 'string' },
      { key: 'rawToolEvents', label: 'Raw tool events', kind: 'string' },
    ]);
  });

  test('reports whether stats and charts have values for hide-if-empty rendering', () => {
    const chartConfig: EvalChartConfig = {
      type: 'line',
      hideIfNoValue: true,
      metrics: [{ source: 'column', key: 'quality', aggregate: 'avg' }],
    };

    expect(
      shouldShowStatDisplay(
        {
          kind: 'column',
          key: 'quality',
          aggregate: 'avg',
          hideIfNoValue: true,
        },
        { hasValue: false },
      ),
    ).toBe(false);
    expect(
      shouldShowStatDisplay(
        {
          kind: 'column',
          key: 'quality',
          aggregate: 'avg',
          hideIfNoValue: true,
        },
        { hasValue: true },
      ),
    ).toBe(true);
    expect(
      chartHasNumericValue(chartConfig, [
        { values: { 'column:quality:avg': null } },
      ]),
    ).toBe(false);
    expect(
      chartHasNumericValue(chartConfig, [
        { values: { 'column:quality:avg': 0 } },
      ]),
    ).toBe(true);
  });

  test('dedupes consecutive chart points by metric and tooltip values', () => {
    const chartConfig: EvalChartConfig = {
      type: 'line',
      dedupeConsecutiveValues: true,
      metrics: [{ source: 'column', key: 'quality', aggregate: 'avg' }],
      tooltipExtras: [{ source: 'column', key: 'costUsd', aggregate: 'avg' }],
    };

    const data = buildChartPoints({
      rows: [
        createScopedRun({ id: '5', quality: 1, cost: 12 }),
        createScopedRun({ id: '4', quality: 1, cost: 11 }),
        createScopedRun({ id: '3', quality: 1, cost: 11 }),
        createScopedRun({ id: '2', quality: null, cost: null }),
        createScopedRun({ id: '1', quality: null, cost: null }),
      ],
      config: chartConfig,
      columnDefs: [
        { key: 'quality', label: 'Quality', kind: 'number' },
        { key: 'costUsd', label: 'Cost', kind: 'number' },
      ],
    });

    expect(data.map((point) => point.shortId)).toEqual(['r1', 'r3', 'r5']);
    expect(data.map((point) => point.axisLabel)).toEqual(['1', '3', 'LATEST']);
  });

  test('keeps non-consecutive repeated chart values', () => {
    const chartConfig: EvalChartConfig = {
      type: 'line',
      dedupeConsecutiveValues: true,
      metrics: [{ source: 'column', key: 'quality', aggregate: 'avg' }],
    };

    const data = buildChartPoints({
      rows: [
        createScopedRun({ id: '4', quality: 1, cost: null }),
        createScopedRun({ id: '3', quality: 2, cost: null }),
        createScopedRun({ id: '2', quality: 1, cost: null }),
        createScopedRun({ id: '1', quality: 1, cost: null }),
      ],
      config: chartConfig,
      columnDefs: [{ key: 'quality', label: 'Quality', kind: 'number' }],
    });

    expect(data.map((point) => point.shortId)).toEqual(['r1', 'r3', 'r4']);
    expect(data.at(-1)?.axisLabel).toBe('LATEST');
  });
});
