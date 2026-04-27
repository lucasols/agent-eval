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
  test('discovers new eval files added under an included glob while watching', async () => {
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
    const runner = createRunner({ watchForChanges: true });

    try {
      await runner.init();
      expect(runner.getEvals()).toEqual([]);

      const discoveryUpdated = new Promise<void>((resolve) => {
        const unsubscribe = runner.subscribeDiscovery((event) => {
          if (event.type !== 'discovery.updated') return;
          if (runner.getEval('created-eval') === undefined) return;
          unsubscribe();
          resolve();
        });
      });

      await mkdir(join(workspacePath, 'evals', 'nested'), { recursive: true });
      await writeFile(
        join(workspacePath, 'evals', 'nested', 'created.eval.ts'),
        `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'created-eval',
  title: 'Created Eval',
});
`,
      );

      await discoveryUpdated;

      expect(runner.getEval('created-eval')?.filePath).toBe(
        'evals/nested/created.eval.ts',
      );
      expect(runner.getEval('created-eval')?.title).toBe('Created Eval');
    } finally {
      await runner.close();
      process.chdir(previousCwd);
    }
  }, 10_000);

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
      numberFormat: { notation: 'compact', decimalPlaces: 1 },
    },
    cost: {
      label: 'Cost',
      format: 'number',
      numberFormat: { prefix: '$', decimalPlaces: 2 },
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
          numberFormat: { notation: 'compact', decimalPlaces: 1 },
        },
        {
          key: 'cost',
          label: 'Cost',
          kind: 'number',
          format: 'number',
          numberFormat: { prefix: '$', decimalPlaces: 2 },
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
    { kind: 'column', key: 'accuracy', aggregate: 'avg', format: 'percent' },
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
          format: 'percent',
        },
        { kind: 'duration' },
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
