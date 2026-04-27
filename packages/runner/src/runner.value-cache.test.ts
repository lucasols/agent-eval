import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvalTraceSpan } from '@agent-evals/shared';
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

async function createValueCacheWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-value-cache-'),
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
    join(workspacePath, 'evals', 'value-cache.eval.ts'),
    `import {
  appendToEvalOutput,
  defineEval,
  evalSpan,
  evalTracer,
  incrementEvalOutput,
  mergeEvalOutput,
  setEvalOutput,
} from '@agent-evals/sdk';

let activeCalls = 0;
let rootCalls = 0;

defineEval({
  id: 'value-cache-eval',
  title: 'Value Cache Eval',
  cases: [{ id: 'first', input: { prompt: 'refund please' } }],
  execute: async ({ input }) => {
    const rootValue = await evalTracer.cache(
      { name: 'root-value', key: { prompt: input.prompt } },
      async () => {
        rootCalls++;
        return { rootCalls };
      },
    );

    await evalTracer.span({ kind: 'agent', name: 'parent' }, async () => {
      const planned = await evalTracer.cache(
        { name: 'value-plan', key: { prompt: input.prompt } },
        async () => {
          activeCalls++;
          evalSpan.setAttribute('planSource', 'fresh');
          evalSpan.incrementAttribute('cachedCostUsd', 0.1);
          evalSpan.incrementAttribute('cachedCostUsd', 0.15);
          evalSpan.appendToAttribute('planSteps', 'draft');
          evalSpan.appendToAttribute('planSteps', 'review');
          evalSpan.mergeAttribute('planMetadata', { source: 'fresh' });
          evalSpan.mergeAttribute('planMetadata', { activeCalls });
          incrementEvalOutput('costUsd', 0.25);
          appendToEvalOutput('auditTrail', 'draft');
          appendToEvalOutput('auditTrail', { step: 'review', activeCalls });
          setEvalOutput('scalarTrail', 'first');
          appendToEvalOutput('scalarTrail', 'second');
          mergeEvalOutput('cacheMetadata', { source: 'fresh' });
          mergeEvalOutput('cacheMetadata', { activeCalls, status: 'ok' });
          await evalTracer.span({ kind: 'tool', name: 'cached-child' }, async () => {
            evalSpan.setAttribute('childSource', 'fresh');
            evalSpan.incrementAttribute('childAttempts', 1);
            evalSpan.appendToAttribute('childEvents', 'lookup');
            evalSpan.mergeAttribute('childMetadata', { source: 'fresh' });
          });
          evalTracer.checkpoint('value-plan-checkpoint', { activeCalls });
          return {
            text: \`cached \${input.prompt}\`,
            activeCalls,
          };
        },
      );

      if (
        typeof planned === 'object' &&
        planned !== null &&
        'text' in planned &&
        typeof planned.text === 'string'
      ) {
        setEvalOutput('response', planned.text);
      }
      if (
        typeof rootValue === 'object' &&
        rootValue !== null &&
        'rootCalls' in rootValue &&
        typeof rootValue.rootCalls === 'number'
      ) {
        setEvalOutput('rootCalls', rootValue.rootCalls);
      }
    });
  },
});
`,
  );

  return workspacePath;
}

function findSpan(spans: EvalTraceSpan[], name: string): EvalTraceSpan {
  const span = spans.find((candidate) => candidate.name === name);
  if (span === undefined) {
    throw new Error(`Expected span ${name}`);
  }
  return span;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function valueCacheRef(
  span: EvalTraceSpan,
  name: string,
): Record<string, unknown> | undefined {
  const refs = span.attributes?.['cache.refs'];
  if (!Array.isArray(refs)) return undefined;
  const candidates: unknown[] = refs.map((ref: unknown) => ref);
  return candidates.find(
    (ref): ref is Record<string, unknown> => isRecord(ref) && ref.name === name,
  );
}

test('caches values without creating a cache span and replays SDK effects', async () => {
  const workspacePath = await createValueCacheWorkspace();
  const previousCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    const firstRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['value-cache-eval'] },
      trials: 1,
      cache: { mode: 'use' },
    });
    await expect
      .poll(() => runner.getRun(firstRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const firstDetail = runner.getCaseDetail(firstRun.manifest.id, 'first');
    const firstTrace = firstDetail?.trace ?? [];
    const firstParent = findSpan(firstTrace, 'parent');
    expect(firstParent.attributes?.planSource).toBe('fresh');
    expect(firstParent.attributes).toMatchObject({
      cachedCostUsd: 0.25,
      planSteps: ['draft', 'review'],
      planMetadata: { source: 'fresh', activeCalls: 1 },
    });
    expect(valueCacheRef(firstParent, 'value-plan')).toMatchObject({
      type: 'value',
      name: 'value-plan',
      status: 'miss',
    });
    expect(firstTrace.some((span) => span.name === 'root-value')).toBe(false);
    expect(firstTrace.some((span) => span.name === 'value-plan')).toBe(false);
    const firstChild = findSpan(firstTrace, 'cached-child');
    expect(firstChild.parentId).toBe(firstParent.id);
    expect(firstChild.attributes).toMatchObject({
      childSource: 'fresh',
      childAttempts: 1,
      childEvents: ['lookup'],
      childMetadata: { source: 'fresh' },
    });
    expect(firstDetail?.columns).toMatchObject({
      response: 'cached refund please',
      rootCalls: 1,
      costUsd: 0.25,
      auditTrail: JSON.stringify(['draft', { step: 'review', activeCalls: 1 }]),
      scalarTrail: JSON.stringify(['first', 'second']),
      cacheMetadata: JSON.stringify({
        source: 'fresh',
        activeCalls: 1,
        status: 'ok',
      }),
    });

    const firstCacheList = await runner.listCache();
    expect(firstCacheList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationType: 'value',
          operationName: 'root-value',
          namespace: 'value-cache-eval__root-value',
        }),
        expect.objectContaining({
          operationType: 'value',
          operationName: 'value-plan',
          namespace: 'value-cache-eval__value-plan',
        }),
      ]),
    );

    const secondRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['value-cache-eval'] },
      trials: 1,
      cache: { mode: 'use' },
    });
    await expect
      .poll(() => runner.getRun(secondRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const secondDetail = runner.getCaseDetail(secondRun.manifest.id, 'first');
    const secondTrace = secondDetail?.trace ?? [];
    const secondParent = findSpan(secondTrace, 'parent');
    expect(secondParent.attributes?.planSource).toBe('fresh');
    expect(secondParent.attributes).toMatchObject({
      cachedCostUsd: 0.25,
      planSteps: ['draft', 'review'],
      planMetadata: { source: 'fresh', activeCalls: 1 },
    });
    const secondCacheRef = valueCacheRef(secondParent, 'value-plan');
    expect(secondCacheRef?.status).toBe('hit');
    expect(typeof secondCacheRef?.storedAt).toBe('string');
    expect(typeof secondCacheRef?.age).toBe('number');
    expect(secondTrace.some((span) => span.name === 'root-value')).toBe(false);
    expect(secondTrace.some((span) => span.name === 'value-plan')).toBe(false);
    const secondChild = findSpan(secondTrace, 'cached-child');
    expect(secondChild.parentId).toBe(secondParent.id);
    expect(secondChild.attributes).toMatchObject({
      childSource: 'fresh',
      childAttempts: 1,
      childEvents: ['lookup'],
      childMetadata: { source: 'fresh' },
    });
    expect(secondDetail?.columns).toMatchObject({
      response: 'cached refund please',
      rootCalls: 1,
      costUsd: 0.25,
      auditTrail: JSON.stringify(['draft', { step: 'review', activeCalls: 1 }]),
      scalarTrail: JSON.stringify(['first', 'second']),
      cacheMetadata: JSON.stringify({
        source: 'fresh',
        activeCalls: 1,
        status: 'ok',
      }),
    });
  } finally {
    process.chdir(previousCwd);
  }
});

test('value cache respects bypass and refresh modes', async () => {
  const workspacePath = await createValueCacheWorkspace();
  const previousCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    const primed = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['value-cache-eval'] },
      trials: 1,
      cache: { mode: 'use' },
    });
    await expect
      .poll(() => runner.getRun(primed.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const bypass = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['value-cache-eval'] },
      trials: 1,
      cache: { mode: 'bypass' },
    });
    await expect
      .poll(() => runner.getRun(bypass.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');
    const bypassParent = findSpan(
      runner.getCaseDetail(bypass.manifest.id, 'first')?.trace ?? [],
      'parent',
    );
    expect(valueCacheRef(bypassParent, 'value-plan')).toMatchObject({
      status: 'bypass',
    });

    const refresh = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['value-cache-eval'] },
      trials: 1,
      cache: { mode: 'refresh' },
    });
    await expect
      .poll(() => runner.getRun(refresh.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');
    const refreshParent = findSpan(
      runner.getCaseDetail(refresh.manifest.id, 'first')?.trace ?? [],
      'parent',
    );
    expect(valueCacheRef(refreshParent, 'value-plan')).toMatchObject({
      status: 'refresh',
    });
  } finally {
    process.chdir(previousCwd);
  }
});
