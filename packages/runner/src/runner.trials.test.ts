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

async function createTrialSelectionWorkspace(
  trialSelection: 'lowestScore' | 'median',
): Promise<string> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-trials-'),
  );
  createdWorkspaces.push(workspacePath);

  await mkdir(join(workspacePath, 'evals'), { recursive: true });
  await writeFile(
    join(workspacePath, 'agent-evals.config.ts'),
    `export default {
  include: ['evals/**/*.eval.ts'],
  trialSelection: '${trialSelection}',
};
`,
  );
  await writeFile(
    join(workspacePath, 'evals', 'trial-selection.eval.ts'),
    `import { defineEval, setEvalOutput, evalTracer, evalSpan } from '@agent-evals/sdk';

const candidates = [
  {
    candidateId: 'careful-follow-up',
    response: 'Ask for photos before issuing a refund.',
    score: 0.91,
  },
  {
    candidateId: 'unsafe-refund',
    response: 'Approve the refund immediately with no verification.',
    score: 0.22,
  },
  {
    candidateId: 'balanced-review',
    response: 'Offer a replacement after a quick damage review.',
    score: 0.64,
  },
];

let executionCount = 0;

function nextCandidate() {
  const candidate = candidates[executionCount % candidates.length];
  executionCount += 1;
  return candidate;
}

defineEval({
  id: 'trial-selection-eval',
  title: 'Trial Selection Eval',
  cases: [
    {
      id: 'damaged-order',
      input: { message: 'The order arrived damaged.' },
    },
  ],
  columns: {
    response: { label: 'Response' },
    candidateId: { label: 'Candidate' },
  },
  execute: async ({ input }) => {
    await evalTracer.span({ kind: 'agent', name: 'trial-selection' }, async () => {
      evalSpan.setAttribute('input', input);

      const candidate = await evalTracer.span(
        {
          kind: 'llm',
          name: 'draft-response',
          cache: { key: { message: input.message } },
        },
        async () => {
          const next = nextCandidate();
          setEvalOutput('candidateId', next.candidateId);
          setEvalOutput('response', next.response);
          setEvalOutput('scorePreview', next.score);
          evalSpan.setAttribute('output', next);
          return next;
        },
      );

      evalSpan.setAttribute('output', candidate);
    });
  },
  scores: {
    quality: {
      compute: ({ outputs }) =>
        typeof outputs.scorePreview === 'number' ? outputs.scorePreview : 0,
    },
  },
});
`,
  );

  return workspacePath;
}

describe('runner trial selection', () => {
  test('stores the lowest-scoring trial and only caches the winning trial result', async () => {
    const workspacePath = await createTrialSelectionWorkspace('lowestScore');

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const startedRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['trial-selection-eval'] },
        trials: 3,
        cache: { mode: 'use' },
      });

      await expect
        .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      const firstRun = runner.getRun(startedRun.manifest.id);
      expect(firstRun).toBeDefined();
      expect(firstRun?.cases).toHaveLength(1);
      expect(firstRun?.summary.totalCases).toBe(1);
      expect(firstRun?.cases[0]).toMatchObject({
        caseId: 'damaged-order',
        evalId: 'trial-selection-eval',
        columns: { quality: 0.22 },
        trial: 1,
      });

      const firstDetail = runner.getCaseDetail(
        startedRun.manifest.id,
        'damaged-order',
      );
      expect(firstDetail?.columns.candidateId).toBe('unsafe-refund');
      expect(
        firstDetail?.trace.find(
          (evalSpan) => evalSpan.name === 'draft-response',
        ),
      ).toMatchObject({ attributes: { 'cache.status': 'miss' } });

      const secondRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['trial-selection-eval'] },
        trials: 1,
        cache: { mode: 'use' },
      });

      await expect
        .poll(() => runner.getRun(secondRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      const secondDetail = runner.getCaseDetail(
        secondRun.manifest.id,
        'damaged-order',
      );
      expect(secondDetail?.columns.candidateId).toBe('unsafe-refund');
      expect(
        secondDetail?.trace.find(
          (evalSpan) => evalSpan.name === 'draft-response',
        ),
      ).toMatchObject({ attributes: { 'cache.status': 'hit' } });
    } finally {
      process.chdir(previousCwd);
    }
  }, 15_000);

  test('supports median trial selection', async () => {
    const workspacePath = await createTrialSelectionWorkspace('median');

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const startedRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['trial-selection-eval'] },
        trials: 3,
        cache: { mode: 'use' },
      });

      await expect
        .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');

      const run = runner.getRun(startedRun.manifest.id);
      expect(run?.cases).toHaveLength(1);
      expect(run?.summary.totalCases).toBe(1);
      expect(run?.cases[0]).toMatchObject({
        caseId: 'damaged-order',
        columns: { quality: 0.64 },
        trial: 2,
      });

      const caseDetail = runner.getCaseDetail(
        startedRun.manifest.id,
        'damaged-order',
      );
      expect(caseDetail?.columns.candidateId).toBe('balanced-review');
    } finally {
      process.chdir(previousCwd);
    }
  }, 15_000);
});
