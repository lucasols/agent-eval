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
  test('discovers the effective eval pass threshold for UI metadata', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-pass-threshold-'),
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
      join(workspacePath, 'evals', 'threshold.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'threshold-eval',
  title: 'Threshold Eval',
  scores: {
    correctness: {
      compute: () => 1,
      passThreshold: 1,
    },
  },
  passThreshold: 0.85,
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      expect(runner.getEval('threshold-eval')?.passThreshold).toBe(0.85);
    } finally {
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
          isScore: true,
          passThreshold: 0.9,
        },
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
