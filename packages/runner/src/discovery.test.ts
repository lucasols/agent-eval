import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createRunner } from './runner.ts';

const createdWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdWorkspaces.map(async (workspacePath) => {
      await rm(workspacePath, { recursive: true, force: true });
    }),
  );
  createdWorkspaces.length = 0;
});

describe('discovery metadata', () => {
  test('discovers new eval files added under an included glob', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-watch-add-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const runner = createRunner({ watchForChanges: false });

    try {
      await runner.init();
      expect(runner.getEvals()).toEqual([]);

      await mkdir(join(workspacePath, 'evals', 'nested'), { recursive: true });
      await writeFile(
        join(workspacePath, 'evals', 'nested', 'created.eval.ts'),
        `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'created-eval',
  title: 'Created Eval',
  execute: () => {},
});
`,
      );
      await runner.refreshDiscovery();

      expect(runner.getEval('created-eval')?.filePath).toBe(
        'evals/nested/created.eval.ts',
      );
      expect(runner.getEval('created-eval')?.title).toBe('Created Eval');
    } finally {
      await runner.close();
      process.chdir(previousCwd);
    }
  });

  test('discovers declared output and score columns before any run executes', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-discovered-columns-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  removeDefaultConfig: true,
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'columns.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'columns-eval',
  title: 'Columns Eval',
  columns: {
    response: {
      label: 'Response',
      format: 'markdown',
    },
    preview: {
      label: 'Preview',
      format: 'image',
      hideInTable: true,
    },
    approved: {
      label: 'Approved',
      format: 'boolean',
    },
    requests: {
      label: 'Requests',
      format: 'number',
      numberFormat: { notation: 'compact' },
    },
    cost: {
      label: 'Cost',
      format: 'number',
      numberFormat: { prefix: '$', minDecimalPlaces: 2, maxDecimalPlaces: 2 },
      align: 'right',
    },
  },
  scores: {
    correctness: {
      compute: () => 1,
      passThreshold: 0.9,
      label: 'Correctness',
      format: 'stars',
      maxStars: 5,
    },
  },
  manualScores: {
    review: {
      label: 'Review',
      format: 'passFail',
      passThreshold: 0.5,
    },
  },
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getEval('columns-eval')?.columnDefs).toEqual([
        {
          key: 'response',
          label: 'Response',
          kind: 'string',
          format: 'markdown',
        },
        {
          key: 'preview',
          label: 'Preview',
          kind: 'string',
          format: 'image',
          hideInTable: true,
        },
        {
          key: 'approved',
          label: 'Approved',
          kind: 'boolean',
          format: 'boolean',
        },
        {
          key: 'requests',
          label: 'Requests',
          kind: 'number',
          format: 'number',
          numberFormat: { notation: 'compact' },
        },
        {
          key: 'cost',
          label: 'Cost',
          kind: 'number',
          format: 'number',
          numberFormat: {
            prefix: '$',
            minDecimalPlaces: 2,
            maxDecimalPlaces: 2,
          },
          align: 'right',
        },
        {
          key: 'correctness',
          label: 'Correctness',
          kind: 'number',
          format: 'stars',
          isScore: true,
          passThreshold: 0.9,
          maxStars: 5,
        },
        {
          key: 'review',
          label: 'Review',
          kind: 'number',
          format: 'passFail',
          isScore: true,
          isManualScore: true,
          passThreshold: 0.5,
        },
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('surfaces the stats row config on discovered eval summaries', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-stats-config-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  removeDefaultConfig: true,
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'stats.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'stats-eval',
  title: 'Stats Eval',
  stats: [
    { kind: 'cases' },
    { kind: 'passRate', accent: true },
    {
      kind: 'column',
      key: 'accuracy',
      aggregate: 'avg',
      format: 'number',
      numberFormat: { suffix: '%', minDecimalPlaces: 1, maxDecimalPlaces: 1 },
    },
    { kind: 'duration' },
  ],
  scores: {
    accuracy: { compute: () => 1, label: 'Accuracy' },
  },
  execute: () => {},
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getEval('stats-eval')?.stats).toEqual([
        { kind: 'cases' },
        { kind: 'passRate', accent: true },
        {
          kind: 'column',
          key: 'accuracy',
          aggregate: 'avg',
          format: 'number',
          numberFormat: {
            suffix: '%',
            minDecimalPlaces: 1,
            maxDecimalPlaces: 1,
          },
        },
        { kind: 'duration' },
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('adds default columns, stats, and charts during discovery', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-default-llm-config-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  removeDefaultConfig: ['reasoningTokens'],
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'llm-defaults.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'llm-defaults',
  title: 'LLM Defaults',
  columns: {
    costUsd: {
      label: 'Custom Cost',
      format: 'number',
      numberFormat: { prefix: 'USD ', minDecimalPlaces: 2, maxDecimalPlaces: 2 },
    },
  },
  stats: [{ kind: 'cases' }],
  charts: [
    { type: 'line', metrics: [{ source: 'builtin', metric: 'passRate' }] },
  ],
  execute: () => {},
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const summary = runner.getEval('llm-defaults');
      expect(summary?.columnDefs.map((def) => def.key)).toEqual([
        'apiCalls',
        'costUsd',
        'llmTurns',
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'cachedInputTokens',
        'cacheCreationInputTokens',
        'llmLatencyMs',
      ]);
      expect(summary?.columnDefs[1]).toMatchObject({
        key: 'costUsd',
        label: 'Custom Cost',
        numberFormat: {
          prefix: 'USD ',
          minDecimalPlaces: 2,
          maxDecimalPlaces: 2,
        },
      });
      expect(summary?.stats).toEqual([
        { kind: 'cases' },
        {
          kind: 'column',
          key: 'apiCalls',
          label: 'API Calls',
          aggregate: 'avg',
          numberFormat: { minDecimalPlaces: 0, maxDecimalPlaces: 0 },
        },
        {
          kind: 'column',
          key: 'costUsd',
          label: 'LLM Cost',
          aggregate: 'avg',
          numberFormat: { prefix: '$' },
        },
        {
          kind: 'column',
          key: 'totalTokens',
          label: 'Tokens',
          aggregate: 'avg',
          numberFormat: { notation: 'compact' },
        },
        {
          kind: 'column',
          key: 'llmTurns',
          label: 'LLM Turns',
          aggregate: 'avg',
          numberFormat: { minDecimalPlaces: 0, maxDecimalPlaces: 0 },
        },
      ]);
      expect(summary?.charts).toEqual([
        {
          type: 'line',
          metrics: [{ source: 'builtin', metric: 'passRate' }],
          tooltipExtras: undefined,
        },
        {
          heading: 'LLM Cost',
          type: 'area',
          metrics: [
            {
              source: 'column',
              key: 'costUsd',
              aggregate: 'avg',
              label: 'Cost',
              color: 'warning',
            },
          ],
          tooltipExtras: undefined,
        },
        {
          heading: 'LLM Tokens',
          type: 'bar',
          metrics: [
            {
              source: 'column',
              key: 'inputTokens',
              aggregate: 'avg',
              label: 'Input',
              color: 'accent',
            },
            {
              source: 'column',
              key: 'outputTokens',
              aggregate: 'avg',
              label: 'Output',
              color: 'success',
            },
            {
              source: 'column',
              key: 'cachedInputTokens',
              aggregate: 'avg',
              label: 'Cached Input',
              color: 'error',
            },
            {
              source: 'column',
              key: 'cacheCreationInputTokens',
              aggregate: 'avg',
              label: 'Cache Write',
              color: 'warning',
            },
          ],
          tooltipExtras: [
            {
              source: 'column',
              key: 'totalTokens',
              aggregate: 'avg',
              label: 'Total',
            },
          ],
        },
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
