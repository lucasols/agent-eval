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

describe('createRunner duplicate identities', () => {
  test('keeps same case ids separate for duplicate eval ids in different files', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-duplicate-id-run-'),
    );
    createdWorkspaces.push(workspacePath);

    await mkdir(join(workspacePath, 'evals', 'returns'), { recursive: true });
    await mkdir(join(workspacePath, 'evals', 'refunds'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
};
`,
    );
    for (const folder of ['returns', 'refunds']) {
      await writeFile(
        join(workspacePath, 'evals', folder, 'workflow.eval.ts'),
        `import { defineEval, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'shared-workflow',
  cases: [{ id: 'same-case', input: { folder: '${folder}' } }],
  execute: ({ input }) => {
    setEvalOutput('folder', input.folder);
  },
});
`,
      );
    }

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const runner = createRunner({ watchForChanges: false });

    try {
      await runner.init();
      const startedRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['shared-workflow'] },
        trials: 1,
      });

      await expect
        .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      const run = runner.getRun(startedRun.manifest.id);
      expect(run?.cases.map((caseRow) => caseRow.caseKey)).toEqual([
        'evals%2Frefunds%2Fworkflow.eval.ts#shared-workflow#same-case',
        'evals%2Freturns%2Fworkflow.eval.ts#shared-workflow#same-case',
      ]);
      expect(
        runner.getCaseDetail(
          startedRun.manifest.id,
          'evals/refunds/workflow.eval.ts#shared-workflow#same-case',
        )?.columns.folder,
      ).toBe('refunds');
      expect(
        runner.getCaseDetail(
          startedRun.manifest.id,
          'evals%2Frefunds%2Fworkflow.eval.ts#shared-workflow#same-case',
        )?.columns.folder,
      ).toBe('refunds');
      expect(
        runner.getCaseDetail(
          startedRun.manifest.id,
          'evals%2Freturns%2Fworkflow.eval.ts#shared-workflow#same-case',
        )?.columns.folder,
      ).toBe('returns');
    } finally {
      await runner.close();
      process.chdir(previousCwd);
    }
  }, 10_000);

  test('errors when one eval defines duplicate case ids', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-duplicate-cases-'),
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
      join(workspacePath, 'evals', 'duplicate-cases.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'duplicate-cases',
  cases: [
    { id: 'same-case', input: {} },
    { id: 'same-case', input: {} },
  ],
  execute: () => {},
});
`,
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const runner = createRunner({ watchForChanges: false });

    try {
      await runner.init();
      const startedRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['duplicate-cases'] },
        trials: 1,
      });

      await expect
        .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('error');

      expect(
        runner.getRun(startedRun.manifest.id)?.summary.errorMessage,
      ).toContain(
        'Duplicate case id in evals/duplicate-cases.eval.ts#duplicate-cases: same-case',
      );
    } finally {
      await runner.close();
      process.chdir(previousCwd);
    }
  }, 10_000);
});
