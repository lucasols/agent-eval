import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaseDetail, ScoreTrace } from '@agent-evals/shared';
import { afterEach, expect, test } from 'vitest';
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

test('keeps score traces separate while allowing cached scorer spans', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-score-traces-'),
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
    join(workspacePath, 'evals', 'score-traces.eval.ts'),
    `import {
  defineEval,
  evalSpan,
  evalTracer,
  incrementEvalOutput,
  setEvalOutput,
} from '@agent-evals/sdk';

defineEval({
  id: 'score-traces-eval',
  title: 'Score Traces Eval',
  cases: [
    { id: 'judge-me', input: { prompt: 'Should the refund be approved?' } },
  ],
  columns: {
    response: { label: 'Response' },
  },
  execute: async ({ input }) => {
    await evalTracer.span({ kind: 'agent', name: 'refund-agent' }, async () => {
      evalSpan.setAttribute('prompt', input.prompt);
      setEvalOutput('response', 'Approved refund after receipt review.');
    });
  },
  deriveFromTracing: ({ trace }) => ({
    executionScorerSpans: trace.findSpansByKind('scorer').length,
  }),
  scores: {
    quality: {
      label: 'Quality',
      passThreshold: 0.8,
      compute: async ({ input, outputs }) => {
        const score = await evalTracer.span(
          {
            kind: 'scorer',
            name: 'llm-judge',
            cache: {
              key: {
                prompt: input.prompt,
                response: outputs.response,
                rubricVersion: 1,
              },
            },
          },
          async () => {
            evalSpan.setAttributes({ model: 'judge-model', verdict: 'pass' });
            incrementEvalOutput('costUsd', 0.02);
            setEvalOutput('privateJudgeNote', 'do not persist as case output');
            return 0.91;
          },
        );

        return typeof score === 'number' ? score : 0;
      },
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

    const firstRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['score-traces-eval'] },
      trials: 1,
      cache: { mode: 'use' },
    });

    await expect
      .poll(() => runner.getRun(firstRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const firstCase = runner.getRun(firstRun.manifest.id)?.cases[0];
    expect(firstCase).toMatchObject({
      caseId: 'judge-me',
      status: 'pass',
      costUsd: 0.02,
      columns: {
        response: 'Approved refund after receipt review.',
        executionScorerSpans: 0,
        quality: 0.91,
      },
    });

    const firstDetail = runner.getCaseDetail(firstRun.manifest.id, 'judge-me');
    expect(firstDetail?.trace.some((span) => span.kind === 'scorer')).toBe(
      false,
    );
    expect(firstDetail?.columns).not.toHaveProperty('privateJudgeNote');
    expect(firstDetail?.cost.totalUsd).toBe(0.02);
    const firstScoreTrace = requireScoreTrace(firstDetail, 'quality');
    expect(firstScoreTrace.trace).toHaveLength(1);
    expect(firstScoreTrace.trace[0]).toMatchObject({
      kind: 'scorer',
      name: 'llm-judge',
      attributes: {
        'cache.status': 'miss',
        model: 'judge-model',
        verdict: 'pass',
      },
    });

    const secondRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['score-traces-eval'] },
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
      'judge-me',
    );
    expect(secondDetail?.cost.totalUsd).toBe(0.02);
    const secondScoreTrace = requireScoreTrace(secondDetail, 'quality');
    expect(secondScoreTrace.trace[0]).toMatchObject({
      kind: 'scorer',
      name: 'llm-judge',
      attributes: {
        'cache.status': 'hit',
        model: 'judge-model',
        verdict: 'pass',
      },
    });
  } finally {
    process.chdir(previousCwd);
  }
}, 15_000);

function requireScoreTrace(
  caseDetail: CaseDetail | undefined,
  scoreKey: string,
): ScoreTrace {
  if (caseDetail === undefined) {
    throw new Error('Expected case detail to exist');
  }
  const scoreTrace = caseDetail.scoringTraces?.[scoreKey];
  if (scoreTrace === undefined) {
    throw new Error(`Expected score trace for "${scoreKey}"`);
  }
  return scoreTrace;
}
