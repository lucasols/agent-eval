import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheDebugKeyFileSchema } from '@agent-evals/shared';
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

test('startRun writes raw cache keys to the debug sidecar', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-cache-debug-'),
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
    join(workspacePath, 'evals', 'cache-debug.eval.ts'),
    `import { defineEval, evalTracer, setEvalOutput } from '@agent-evals/sdk';

defineEval({
  id: 'ui-cache-debug',
  cases: [{ id: 'first', input: { prompt: 'inspect this cache key' } }],
  execute: async ({ input }) => {
    const result = await evalTracer.span(
      {
        kind: 'llm',
        name: 'debuggable-call',
        cache: { key: { prompt: input.prompt, model: 'debug-model' } },
      },
      () => ({ text: input.prompt }),
    );
    setEvalOutput('response', result.text);
  },
});
`,
  );

  const previousCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const runner = createRunner({ watchForChanges: false });
    await runner.init();

    const startedRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['ui-cache-debug'] },
      trials: 1,
      cache: { mode: 'use' },
    });

    await expect
      .poll(() => runner.getRun(startedRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const debugFile = cacheDebugKeyFileSchema.parse(
      JSON.parse(
        await readFile(
          join(
            workspacePath,
            '.agent-evals',
            'cache-debug',
            'ui-cache-debug.json',
          ),
          'utf8',
        ),
      ),
    );
    const [debugEntry, extraDebugEntry] = Object.values(debugFile.entries);
    if (debugEntry === undefined) {
      throw new Error('Expected a raw cache key debug entry');
    }
    expect(extraDebugEntry).toBeUndefined();
    expect(debugEntry).toMatchObject({
      namespace: 'ui-cache-debug__debuggable-call',
      operationType: 'span',
      operationName: 'debuggable-call',
      rawKey: { prompt: 'inspect this cache key', model: 'debug-model' },
    });

    const cacheEntry = await runner.getCacheEntry(
      'ui-cache-debug__debuggable-call',
      debugEntry.key,
    );
    expect(cacheEntry?.debugKey?.rawKey).toEqual({
      prompt: 'inspect this cache key',
      model: 'debug-model',
    });
  } finally {
    process.chdir(previousCwd);
  }
}, 10_000);
