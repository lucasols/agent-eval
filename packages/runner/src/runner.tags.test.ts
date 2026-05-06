import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesEvalTags } from '@agent-evals/sdk';
import { expect, test } from 'vitest';
import { createRunner } from './runner.ts';

async function writeTaggedWorkspace(workspacePath: string): Promise<void> {
  await mkdir(join(workspacePath, 'evals'), { recursive: true });
  await writeFile(
    join(workspacePath, 'agent-evals.config.ts'),
    `export default {
  include: ['evals/**/*.eval.ts'],
  tags: ['global'],
  allowCliRunAll: true,
};
`,
  );
  await writeFile(
    join(workspacePath, 'evals', 'tags.eval.ts'),
    `import { defineEval, matchesEvalTags, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'tagged-eval',
  tags: ['refunds'],
  cases: [
    { id: 'plain-case', input: { kind: 'plain' } },
    { id: 'media-case', tags: ['media'], input: { kind: 'media' } },
  ],
  execute: () => {
    setEvalOutput('isMedia', matchesEvalTags({ any: ['media'] }));
    setEvalOutput('isRefund', matchesEvalTags('refunds'));
  },
});
`,
  );
}

test('filters cases by inherited eval and case tags', async () => {
  expect(matchesEvalTags('media')).toBe(false);
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-evals-tags-'));
  const originalCwd = process.cwd();
  process.chdir(workspacePath);
  try {
    await writeTaggedWorkspace(workspacePath);
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    expect(runner.getEval('tagged-eval')?.tags).toEqual(['global', 'refunds']);

    const mediaRun = await runner.startRun({
      target: {
        mode: 'evalIds',
        evalIds: ['tagged-eval'],
        tagsFilter: ['media'],
      },
      trials: 1,
    });
    await expect
      .poll(() => runner.getRun(mediaRun.manifest.id)?.summary.totalCases)
      .toBe(1);
    const mediaResult = runner.getRun(mediaRun.manifest.id);
    expect(mediaResult?.cases).toHaveLength(1);
    expect(mediaResult?.cases[0]).toMatchObject({
      caseId: 'media-case',
      tags: ['global', 'refunds', 'media'],
      columns: { isMedia: true, isRefund: true },
    });

    const inheritedRun = await runner.startRun({
      target: {
        mode: 'evalIds',
        evalIds: ['tagged-eval'],
        tagsFilter: ['global && refunds'],
      },
      trials: 1,
    });
    await expect
      .poll(() => runner.getRun(inheritedRun.manifest.id)?.summary.totalCases)
      .toBe(2);
  } finally {
    process.chdir(originalCwd);
  }
});

test('reports invalid removed global tags during discovery', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-evals-bad-tags-'));
  const originalCwd = process.cwd();
  process.chdir(workspacePath);
  try {
    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  tags: ['global'],
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'invalid-tags.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'invalid-tags',
  removeTags: ['missing'],
  execute: () => {},
});
`,
    );
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    expect(runner.getDiscoveryIssues()).toEqual([
      expect.objectContaining({ type: 'invalid-tags', evalId: 'invalid-tags' }),
    ]);
  } finally {
    process.chdir(originalCwd);
  }
});
