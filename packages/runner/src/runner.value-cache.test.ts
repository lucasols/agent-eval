import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CacheAdapter, TraceCacheManualInfo } from '@agent-evals/sdk';
import {
  appendToEvalOutput,
  evalSpan,
  evalTracer,
  runInEvalScope,
  setEvalOutput,
} from '@agent-evals/sdk';
import type { CacheEntry, EvalTraceSpan } from '@agent-evals/shared';
import { afterEach, expect, test } from 'vitest';
import { createRunner } from './runner.ts';

const createdWorkspaces: string[] = [];
const serializedPlanDate = {
  __aecs: 'v1:Date',
  value: '2024-01-02T03:04:05.000Z',
};

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
          const planDate = new Date('2024-01-02T03:04:05.000Z');
          const planTags = new Map([['tier', 'gold']]);
          evalSpan.setAttribute('planSource', 'fresh');
          evalSpan.setAttribute('planDate', planDate);
          evalSpan.setAttribute('planTags', planTags);
          evalSpan.incrementAttribute('cachedCostUsd', 0.1);
          evalSpan.incrementAttribute('cachedCostUsd', 0.15);
          evalSpan.appendToAttribute('planSteps', 'draft');
          evalSpan.appendToAttribute('planSteps', 'review');
          evalSpan.mergeAttribute('planMetadata', { source: 'fresh' });
          evalSpan.mergeAttribute('planMetadata', { activeCalls });
          incrementEvalOutput('costUsd', 0.25);
          setEvalOutput('plannedDateOutput', planDate);
          appendToEvalOutput('auditTrail', 'draft');
          appendToEvalOutput('auditTrail', { step: 'review', activeCalls });
          setEvalOutput('scalarTrail', 'first');
          appendToEvalOutput('scalarTrail', 'second');
          mergeEvalOutput('cacheMetadata', { source: 'fresh' });
          mergeEvalOutput('cacheMetadata', { activeCalls, status: 'ok' });
          await evalTracer.span({ kind: 'tool', name: 'cached-child' }, async () => {
            evalSpan.setAttribute('childSource', 'fresh');
            evalSpan.setAttribute('childDate', planDate);
            evalSpan.incrementAttribute('childAttempts', 1);
            evalSpan.appendToAttribute('childEvents', 'lookup');
            evalSpan.mergeAttribute('childMetadata', { source: 'fresh' });
          });
          evalTracer.checkpoint('value-plan-checkpoint', { activeCalls, planDate });
          return {
            text: \`cached \${input.prompt}\`,
            activeCalls,
            generatedAt: planDate,
            metadata: planTags,
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
        typeof planned === 'object' &&
        planned !== null &&
        'generatedAt' in planned &&
        planned.generatedAt instanceof Date
      ) {
        setEvalOutput('plannedIso', planned.generatedAt.toISOString());
      }
      if (
        typeof planned === 'object' &&
        planned !== null &&
        'metadata' in planned &&
        planned.metadata instanceof Map
      ) {
        setEvalOutput('plannedTier', planned.metadata.get('tier'));
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

function isRunArtifactValue(
  value: unknown,
): value is { source: 'run'; artifactId: string } {
  return (
    isRecord(value) &&
    value.source === 'run' &&
    typeof value.artifactId === 'string'
  );
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

function expectDateValue(value: unknown, iso: string): void {
  expect(value).toBeInstanceOf(Date);
  if (value instanceof Date) {
    expect(value.toISOString()).toBe(iso);
  }
}

function expectMapEntry(value: unknown, key: string, expected: unknown): void {
  expect(value).toBeInstanceOf(Map);
  if (value instanceof Map) {
    expect(value.get(key)).toBe(expected);
  }
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
    expect(runner.getRun(firstRun.manifest.id)?.cases).toEqual([
      expect.objectContaining({ cacheHits: 0, cacheOperations: 2 }),
    ]);

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
      plannedIso: '2024-01-02T03:04:05.000Z',
      plannedTier: 'gold',
      plannedDateOutput: serializedPlanDate,
      auditTrail: ['draft', { step: 'review', activeCalls: 1 }],
      scalarTrail: ['first', 'second'],
      cacheMetadata: { source: 'fresh', activeCalls: 1, status: 'ok' },
    });

    const firstCacheList = await runner.listCache();
    expect(firstCacheList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ namespace: 'value-cache-eval.root-value' }),
        expect.objectContaining({ namespace: 'value-cache-eval.value-plan' }),
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
    expect(runner.getRun(secondRun.manifest.id)?.cases).toEqual([
      expect.objectContaining({ cacheHits: 2, cacheOperations: 2 }),
    ]);

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
      plannedIso: '2024-01-02T03:04:05.000Z',
      plannedTier: 'gold',
      plannedDateOutput: serializedPlanDate,
      auditTrail: ['draft', { step: 'review', activeCalls: 1 }],
      scalarTrail: ['first', 'second'],
      cacheMetadata: { source: 'fresh', activeCalls: 1, status: 'ok' },
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

test('temporary value cache stores outside durable cache and replays file outputs', async () => {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-temporary-cache-'),
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
    join(workspacePath, 'evals', 'temporary-file-cache.eval.ts'),
    `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defineEval, evalTracer, setEvalOutput } from '@agent-evals/sdk';

function nextBodyCall() {
  const path = 'body-calls.txt';
  const previous = existsSync(path) ? Number(readFileSync(path, 'utf-8')) : 0;
  const next = previous + 1;
  writeFileSync(path, String(next));
  return next;
}

defineEval({
  id: 'temporary-file-cache',
  cases: [{ id: 'file', input: { name: 'report' } }],
  columns: { report: { format: 'file' } },
  execute: async ({ input }) => {
    await evalTracer.cache(
      {
        name: 'large-report',
        namespace: 'temporary-file-cache.large-report',
        key: input,
        storage: 'temporary',
      },
      async () => {
        const bodyCalls = nextBodyCall();
        setEvalOutput('bodyCalls', bodyCalls);
        setEvalOutput(
          'report',
          new Blob([\`report-\${bodyCalls}-\${input.name}\`], {
            type: 'text/plain',
          }),
          { format: 'file' },
        );
        return { bodyCalls };
      },
    );
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
      target: { mode: 'evalIds', evalIds: ['temporary-file-cache'] },
      trials: 1,
      cache: { mode: 'use' },
    });
    await expect
      .poll(() => runner.getRun(firstRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    const secondRun = await runner.startRun({
      target: { mode: 'evalIds', evalIds: ['temporary-file-cache'] },
      trials: 1,
      cache: { mode: 'use' },
    });
    await expect
      .poll(() => runner.getRun(secondRun.manifest.id)?.manifest.status, {
        timeout: 10_000,
      })
      .toBe('completed');

    expect(await readFile(join(workspacePath, 'body-calls.txt'), 'utf-8')).toBe(
      '1',
    );
    expect(existsSync(join(workspacePath, '.agent-evals', 'cache'))).toBe(
      false,
    );
    expect(
      existsSync(join(workspacePath, '.agent-evals', 'tmp', 'cache')),
    ).toBe(true);

    const firstDetail = runner.getCaseDetail(firstRun.manifest.id, 'file');
    const secondDetail = runner.getCaseDetail(secondRun.manifest.id, 'file');
    expect(firstDetail?.cacheRefs).toEqual([
      expect.objectContaining({
        name: 'large-report',
        status: 'miss',
        storage: 'temporary',
      }),
    ]);
    expect(secondDetail?.cacheRefs).toEqual([
      expect.objectContaining({
        name: 'large-report',
        status: 'hit',
        storage: 'temporary',
      }),
    ]);
    expect(firstDetail?.columns.bodyCalls).toBe(1);
    expect(secondDetail?.columns.bodyCalls).toBe(1);

    const firstReport = firstDetail?.columns.report;
    const secondReport = secondDetail?.columns.report;
    expect(isRunArtifactValue(firstReport)).toBe(true);
    expect(isRunArtifactValue(secondReport)).toBe(true);
    if (isRunArtifactValue(firstReport) && isRunArtifactValue(secondReport)) {
      expect(firstReport.artifactId).not.toBe(secondReport.artifactId);
      const firstArtifactPath = runner.getArtifactPath(firstReport.artifactId);
      const secondArtifactPath = runner.getArtifactPath(
        secondReport.artifactId,
      );
      expect(typeof firstArtifactPath).toBe('string');
      expect(typeof secondArtifactPath).toBe('string');
      if (
        typeof firstArtifactPath === 'string' &&
        typeof secondArtifactPath === 'string'
      ) {
        await expect(readFile(firstArtifactPath, 'utf-8')).resolves.toBe(
          'report-1-report',
        );
        await expect(readFile(secondArtifactPath, 'utf-8')).resolves.toBe(
          'report-1-report',
        );
      }
    }
  } finally {
    process.chdir(previousCwd);
  }
});

test('revives rich cached values with Seroval while using the existing cache key adapter', async () => {
  const entries = new Map<string, CacheEntry>();
  const adapter = {
    lookup(namespace, keyHash) {
      return Promise.resolve(entries.get(`${namespace}:${keyHash}`) ?? null);
    },
    write(entry) {
      entries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  } satisfies CacheAdapter;

  let calls = 0;
  async function runCachedValue() {
    return await runInEvalScope(
      'case',
      async () => {
        return await evalTracer.cache(
          { name: 'rich-value', key: { id: 'same-key' } },
          () => {
            calls++;
            const generatedAt = new Date('2024-01-02T03:04:05.000Z');
            const metadata = new Map([['tier', 'gold']]);
            setEvalOutput('generatedAt', generatedAt);
            evalTracer.checkpoint('rich-checkpoint', { generatedAt });
            return { generatedAt, metadata };
          },
        );
      },
      { cacheContext: { adapter, mode: 'use', evalId: 'rich-cache-eval' } },
    );
  }

  const first = await runCachedValue();
  const second = await runCachedValue();

  expect(first.error).toBeUndefined();
  expect(second.error).toBeUndefined();
  expect(calls).toBe(1);
  expect(entries.size).toBe(1);

  expect(isRecord(second.result)).toBe(true);
  if (isRecord(second.result)) {
    expectDateValue(second.result.generatedAt, '2024-01-02T03:04:05.000Z');
    expectMapEntry(second.result.metadata, 'tier', 'gold');
  }

  expectDateValue(second.scope.outputs.generatedAt, '2024-01-02T03:04:05.000Z');
  const checkpoint = second.scope.checkpoints.get('rich-checkpoint');
  expect(isRecord(checkpoint)).toBe(true);
  if (isRecord(checkpoint)) {
    expectDateValue(checkpoint.generatedAt, '2024-01-02T03:04:05.000Z');
  }
});

test('manual cache get and set let callers skip error results', async () => {
  const durableEntries = new Map<string, CacheEntry>();
  const temporaryEntries = new Map<string, CacheEntry>();
  const durableAdapter = {
    lookup(namespace, keyHash) {
      return Promise.resolve(
        durableEntries.get(`${namespace}:${keyHash}`) ?? null,
      );
    },
    write(entry) {
      durableEntries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  } satisfies CacheAdapter;
  const temporaryAdapter = {
    lookup(namespace, keyHash) {
      return Promise.resolve(
        temporaryEntries.get(`${namespace}:${keyHash}`) ?? null,
      );
    },
    write(entry) {
      temporaryEntries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  } satisfies CacheAdapter;

  type PdfResult =
    | { error: false; value: ArrayBuffer }
    | { error: true; message: string };

  const cacheInfo = {
    namespace: 'pdf-worker.generate-pdf',
    key: {
      workerUrl: 'https://pdf-worker.example.test/generate',
      requestBody: { template: 'receipt', receiptId: 'r-123' },
    },
    storage: 'temporary',
  } satisfies TraceCacheManualInfo;
  let fetchPdfCalls = 0;

  async function runGeneratePdf(shouldFail: boolean): Promise<{
    result: PdfResult | undefined;
    spans: EvalTraceSpan[];
  }> {
    const run = await runInEvalScope(
      'case',
      async () => {
        return await evalTracer.span(
          { kind: 'tool', name: 'generate-pdf' },
          async (): Promise<PdfResult> => {
            const cached = await evalTracer.cache.get<ArrayBuffer>(cacheInfo);
            if (cached.hit) return { error: false, value: cached.value };

            fetchPdfCalls++;
            if (shouldFail) {
              return { error: true, message: 'pdf worker failed' };
            }

            const value = new Uint8Array([fetchPdfCalls, 2, 3]).buffer;
            await evalTracer.cache.set({ ...cacheInfo, value });
            return { error: false, value };
          },
        );
      },
      {
        cacheContext: {
          adapter: durableAdapter,
          temporaryAdapter,
          mode: 'use',
          evalId: 'manual-pdf-cache-eval',
        },
      },
    );

    expect(run.error).toBeUndefined();
    return { result: run.result, spans: run.scope.spans };
  }

  const failed = await runGeneratePdf(true);
  const firstSuccess = await runGeneratePdf(false);
  const secondSuccess = await runGeneratePdf(false);

  expect(fetchPdfCalls).toBe(2);
  expect(durableEntries.size).toBe(0);
  expect(temporaryEntries.size).toBe(1);
  expect(failed.result).toEqual({
    error: true,
    message: 'pdf worker failed',
  });
  expect(firstSuccess.result?.error).toBe(false);
  expect(secondSuccess.result?.error).toBe(false);
  if (
    firstSuccess.result?.error === false &&
    secondSuccess.result?.error === false
  ) {
    expect(Array.from(new Uint8Array(firstSuccess.result.value))).toEqual([
      2, 2, 3,
    ]);
    expect(Array.from(new Uint8Array(secondSuccess.result.value))).toEqual([
      2, 2, 3,
    ]);
  }

  expect(
    valueCacheRef(findSpan(failed.spans, 'generate-pdf'), cacheInfo.namespace),
  ).toMatchObject({
    status: 'miss',
    storage: 'temporary',
  });
  expect(
    valueCacheRef(
      findSpan(firstSuccess.spans, 'generate-pdf'),
      cacheInfo.namespace,
    ),
  ).toMatchObject({
    status: 'miss',
    storage: 'temporary',
  });
  expect(
    valueCacheRef(
      findSpan(secondSuccess.spans, 'generate-pdf'),
      cacheInfo.namespace,
    ),
  ).toMatchObject({
    status: 'hit',
    storage: 'temporary',
  });
});

test('cached spans can use the temporary cache adapter', async () => {
  const durableEntries = new Map<string, CacheEntry>();
  const temporaryEntries = new Map<string, CacheEntry>();
  const durableAdapter = {
    lookup(namespace, keyHash) {
      return Promise.resolve(
        durableEntries.get(`${namespace}:${keyHash}`) ?? null,
      );
    },
    write(entry) {
      durableEntries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  } satisfies CacheAdapter;
  const temporaryAdapter = {
    lookup(namespace, keyHash) {
      return Promise.resolve(
        temporaryEntries.get(`${namespace}:${keyHash}`) ?? null,
      );
    },
    write(entry) {
      temporaryEntries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  } satisfies CacheAdapter;

  let calls = 0;
  async function runCachedSpan() {
    return await runInEvalScope(
      'case',
      async () => {
        return await evalTracer.span(
          {
            kind: 'tool',
            name: 'temporary-span',
            cache: {
              namespace: 'temporary-span-cache',
              key: { id: 'same' },
              storage: 'temporary',
            },
          },
          () => {
            calls++;
            setEvalOutput('calls', calls);
            return { calls };
          },
        );
      },
      {
        cacheContext: {
          adapter: durableAdapter,
          temporaryAdapter,
          mode: 'use',
          evalId: 'temporary-span-eval',
        },
      },
    );
  }

  const first = await runCachedSpan();
  const second = await runCachedSpan();

  expect(first.error).toBeUndefined();
  expect(second.error).toBeUndefined();
  expect(calls).toBe(1);
  expect(durableEntries.size).toBe(0);
  expect(temporaryEntries.size).toBe(1);
  expect(
    findSpan(first.scope.spans, 'temporary-span').attributes,
  ).toMatchObject({ 'cache.status': 'miss', 'cache.storage': 'temporary' });
  expect(
    findSpan(second.scope.spans, 'temporary-span').attributes,
  ).toMatchObject({ 'cache.status': 'hit', 'cache.storage': 'temporary' });
  expect(second.scope.outputs.calls).toBe(1);
});

test('value cache replay does not duplicate sibling spans from concurrent work', async () => {
  const entries = new Map<string, CacheEntry>();
  const adapter = {
    lookup(namespace, keyHash) {
      return Promise.resolve(entries.get(`${namespace}:${keyHash}`) ?? null);
    },
    write(entry) {
      entries.set(`${entry.namespace}:${entry.key}`, entry);
      return Promise.resolve();
    },
  } satisfies CacheAdapter;

  let cacheBodyCalls = 0;

  async function runConcurrentTrace(): Promise<{
    outputs: Record<string, unknown>;
    spans: EvalTraceSpan[];
  }> {
    let markCacheBodyStarted: (() => void) | undefined;
    const cacheBodyStarted = new Promise<'body'>((resolve) => {
      markCacheBodyStarted = () => {
        resolve('body');
      };
    });
    let allowCacheFinish: (() => void) | undefined;
    const cacheMayFinish = new Promise<void>((resolve) => {
      allowCacheFinish = resolve;
    });

    const result = await runInEvalScope(
      'case',
      async () => {
        await evalTracer.span({ kind: 'agent', name: 'parent' }, async () => {
          const cachedPlan = evalTracer.cache(
            { name: 'plan', key: { id: 'same-plan' } },
            async () => {
              cacheBodyCalls++;
              markCacheBodyStarted?.();
              await cacheMayFinish;
              evalSpan.setAttribute('cacheBranch', 'fresh');
              return { plan: 'cached' };
            },
          );

          const siblingApi = (async () => {
            await Promise.race([cacheBodyStarted, cachedPlan]);
            evalSpan.incrementAttribute('siblingCount', 1);
            appendToEvalOutput('siblingEvents', 'api');
            await evalTracer.span({ kind: 'api', name: 'sibling-api' }, () => {
              setEvalOutput('siblingApiRan', true);
            });
            allowCacheFinish?.();
          })();

          await Promise.all([cachedPlan, siblingApi]);
        });
      },
      { cacheContext: { adapter, mode: 'use', evalId: 'concurrent-cache' } },
    );

    expect(result.error).toBeUndefined();
    return { outputs: result.scope.outputs, spans: result.scope.spans };
  }

  const firstTrace = await runConcurrentTrace();
  const secondTrace = await runConcurrentTrace();

  expect(cacheBodyCalls).toBe(1);
  const firstParent = findSpan(firstTrace.spans, 'parent');
  const secondParent = findSpan(secondTrace.spans, 'parent');
  expect(firstParent.attributes).toMatchObject({
    cacheBranch: 'fresh',
    siblingCount: 1,
  });
  expect(secondParent.attributes).toMatchObject({
    cacheBranch: 'fresh',
    siblingCount: 1,
  });
  expect(firstTrace.outputs.siblingEvents).toEqual(['api']);
  expect(secondTrace.outputs.siblingEvents).toEqual(['api']);
  expect(
    firstTrace.spans.filter((span) => span.name === 'sibling-api'),
  ).toHaveLength(1);
  expect(
    secondTrace.spans.filter((span) => span.name === 'sibling-api'),
  ).toHaveLength(1);
});
