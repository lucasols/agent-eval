import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseDetailSchema, traceSpanSchema } from '@agent-evals/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import { createRunner } from './runner.ts';

const createdWorkspaces: string[] = [];
const traceCollectionSchema = z.array(traceSpanSchema);

afterEach(async () => {
  await Promise.all(
    createdWorkspaces.map(async (workspacePath) => {
      await rm(workspacePath, { recursive: true, force: true });
    }),
  );
  createdWorkspaces.length = 0;
});

describe('derived attributes recalculation', () => {
  test('recalculates derived attributes for a persisted case trace', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'agent-evals-runner-derived-attributes-'),
    );
    createdWorkspaces.push(workspacePath);

    const runId = '2026-04-21T12-00-00Z_derived';
    const runDir = join(workspacePath, '.agent-evals', 'runs', runId);

    await mkdir(join(workspacePath, 'evals'), { recursive: true });
    await mkdir(join(runDir, 'case-details'), { recursive: true });
    await mkdir(join(runDir, 'traces'), { recursive: true });

    await writeFile(
      join(workspacePath, 'agent-evals.config.ts'),
      `export default {
  include: ['evals/**/*.eval.ts'],
  llmCalls: {
    derivedAttributes: {
      'usage.billableTokens': ({ get }) => {
        const inputTokens = get('usage.inputTokens');
        const outputTokens = get('usage.outputTokens');
        if (typeof inputTokens !== 'number') return undefined;
        if (typeof outputTokens !== 'number') return undefined;
        return inputTokens + outputTokens;
      },
    },
  },
};
`,
    );
    await writeFile(
      join(workspacePath, 'evals', 'derived.eval.ts'),
      `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'derived-eval',
  title: 'Derived Eval',
});
`,
    );

    await writeFile(
      join(runDir, 'run.json'),
      JSON.stringify(
        {
          id: runId,
          shortId: 'r0',
          status: 'completed',
          startedAt: '2026-04-21T12:00:00.000Z',
          endedAt: '2026-04-21T12:00:02.000Z',
          target: { mode: 'evalIds', evalIds: ['derived-eval'] },
          trials: 1,
          cacheMode: 'use',
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(runDir, 'summary.json'),
      JSON.stringify(
        {
          runId,
          status: 'completed',
          totalCases: 1,
          passedCases: 1,
          failedCases: 0,
          errorCases: 0,
          cancelledCases: 0,
          totalDurationMs: 12,
          errorMessage: null,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(runDir, 'cases.jsonl'),
      `${JSON.stringify({
        caseId: 'simple',
        evalId: 'derived-eval',
        status: 'pass',
        durationMs: 12,
        columns: {},
        trial: 0,
      })}\n`,
    );

    const caseDetail = {
      caseId: 'simple',
      evalId: 'derived-eval',
      status: 'pass',
      input: null,
      trace: [
        {
          id: 'span-1',
          parentId: null,
          caseId: 'simple',
          kind: 'llm',
          name: 'call-model',
          startedAt: '2026-04-21T12:00:00.000Z',
          endedAt: '2026-04-21T12:00:00.012Z',
          status: 'ok',
          attributes: { usage: { inputTokens: 10, outputTokens: 5 } },
        },
      ],
      traceDisplay: {},
      columns: {},
      assertionFailures: [],
      logs: [],
      error: null,
      trial: 0,
      cacheRefs: [],
    };
    await writeFile(
      join(runDir, 'case-details', 'simple.json'),
      JSON.stringify(caseDetail, null, 2),
    );
    await writeFile(
      join(runDir, 'traces', 'simple.json'),
      JSON.stringify(caseDetail.trace, null, 2),
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);

    try {
      const runner = createRunner({ watchForChanges: false });
      await runner.init();

      const result = await runner.recalculateDerivedAttributesForCase({
        runId,
        caseId: 'simple',
      });

      expect(result.updated).toBe(true);
      if (!result.updated) return;
      expect(result.caseDetail.trace[0]?.attributes?.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        billableTokens: 15,
      });

      const persistedCaseDetail = caseDetailSchema.parse(
        JSON.parse(
          await readFile(join(runDir, 'case-details', 'simple.json'), 'utf-8'),
        ),
      );
      const persistedTrace = traceCollectionSchema.parse(
        JSON.parse(
          await readFile(join(runDir, 'traces', 'simple.json'), 'utf-8'),
        ),
      );
      expect(persistedCaseDetail.trace[0]?.attributes?.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        billableTokens: 15,
      });
      expect(persistedTrace[0]?.attributes?.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        billableTokens: 15,
      });
    } finally {
      process.chdir(previousCwd);
    }
  });
});
