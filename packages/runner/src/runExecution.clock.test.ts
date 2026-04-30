import {
  advanceEvalTime,
  evalSpan,
  evalTracer,
  getEvalStartTime,
  setEvalOutput,
} from '@agent-evals/sdk';
import { expect, test } from 'vitest';
import { runCase } from './runExecution.ts';

async function runClockCase(evalDef: Parameters<typeof runCase>[0]['evalDef']) {
  return await runCase({
    evalDef,
    evalId: 'clock-eval',
    evalCase: { id: 'case-one', input: {} },
    globalTraceDisplay: undefined,
    trial: 0,
    startTime: Date.now(),
    cacheAdapter: null,
    cacheMode: 'use',
    codeFingerprint: 'fingerprint',
    moduleIsolation: undefined,
    evalFilePath: '/repo/evals/clock.eval.ts',
    workspaceRoot: '/repo',
    artifactDir: '/repo/.agent-evals/runs/run-id/artifacts',
    runId: 'run-id',
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test('runCase uses a shifted eval clock by default', async () => {
  const defaultStartMs = new Date('2026-04-10T00:00:00.000Z').getTime();
  const result = await runClockCase({
    id: 'clock-eval',
    execute: async () => {
      setEvalOutput('startTimeIso', getEvalStartTime().toISOString());
      setEvalOutput('dateIso', new Date().toISOString());
      setEvalOutput('dateNow', Date.now());
      await delay(5);
      setEvalOutput('afterDelayNow', Date.now());
      const advancedAt = advanceEvalTime('minutes', 5);
      setEvalOutput('advancedAt', advancedAt.toISOString());
      await evalTracer.span({ kind: 'tool', name: 'dated-step' }, () => {
        evalSpan.setAttribute('insideSpanIso', new Date().toISOString());
      });
    },
    deriveFromTracing: () => ({ derivedIso: new Date().toISOString() }),
    scores: {
      dateScore: () =>
        Date.now() >= new Date('2026-04-10T00:05:00.000Z').getTime() ? 1 : 0,
    },
  });

  expect(result.caseDetail.columns).toMatchObject({ dateScore: 1 });
  expect(result.caseDetail.columns.startTimeIso).toBe(
    '2026-04-10T00:00:00.000Z',
  );
  const dateIso = result.caseDetail.columns.dateIso;
  const dateNow = result.caseDetail.columns.dateNow;
  const afterDelayNow = result.caseDetail.columns.afterDelayNow;
  const advancedAt = result.caseDetail.columns.advancedAt;
  const derivedIso = result.caseDetail.columns.derivedIso;
  expect(typeof dateIso).toBe('string');
  expect(typeof dateNow).toBe('number');
  expect(typeof afterDelayNow).toBe('number');
  expect(typeof advancedAt).toBe('string');
  expect(typeof derivedIso).toBe('string');

  if (typeof dateIso === 'string') {
    expect(new Date(dateIso).getTime()).toBeGreaterThanOrEqual(defaultStartMs);
  }
  if (typeof dateNow === 'number' && typeof afterDelayNow === 'number') {
    expect(dateNow).toBeGreaterThanOrEqual(defaultStartMs);
    expect(afterDelayNow).toBeGreaterThan(dateNow);
  }
  if (
    typeof advancedAt === 'string' &&
    typeof afterDelayNow === 'number' &&
    typeof derivedIso === 'string'
  ) {
    const advancedMs = new Date(advancedAt).getTime();
    expect(advancedMs).toBeGreaterThanOrEqual(afterDelayNow + 300_000);
    expect(new Date(derivedIso).getTime()).toBeGreaterThanOrEqual(advancedMs);

    const insideSpanIso = result.caseDetail.trace[0]?.attributes?.insideSpanIso;
    expect(typeof insideSpanIso).toBe('string');
    if (typeof insideSpanIso === 'string') {
      expect(new Date(insideSpanIso).getTime()).toBeGreaterThanOrEqual(
        advancedMs,
      );
    }
    expect(
      new Date(result.caseDetail.trace[0]?.startedAt ?? '').getTime(),
    ).toBeGreaterThanOrEqual(advancedMs);
    expect(
      new Date(result.caseDetail.trace[0]?.endedAt ?? '').getTime(),
    ).toBeGreaterThanOrEqual(advancedMs);
  }
});

test('runCase can freeze eval time until it is advanced manually', async () => {
  const result = await runClockCase({
    id: 'clock-eval',
    freezeTime: true,
    execute: async () => {
      setEvalOutput('startTimeIso', getEvalStartTime().toISOString());
      const firstNow = Date.now();
      await delay(5);
      const secondNow = Date.now();
      setEvalOutput('firstNow', firstNow);
      setEvalOutput('secondNow', secondNow);
      setEvalOutput('advancedAt', advanceEvalTime('seconds', 30).toISOString());
      setEvalOutput('thirdNow', Date.now());
    },
  });

  expect(result.caseDetail.columns).toMatchObject({
    firstNow: 1775779200000,
    startTimeIso: '2026-04-10T00:00:00.000Z',
    secondNow: 1775779200000,
    advancedAt: '2026-04-10T00:00:30.000Z',
    thirdNow: 1775779230000,
  });
});

test('runCase uses an eval startTime override when provided', async () => {
  const result = await runClockCase({
    id: 'clock-eval',
    startTime: '2024-01-02T03:04:05.000Z',
    execute: async () => {
      setEvalOutput('startTimeIso', getEvalStartTime().toISOString());
      setEvalOutput('dateIso', new Date().toISOString());
      await evalTracer.span({ kind: 'tool', name: 'dated-step' }, () => {});
    },
  });

  expect(result.caseDetail.columns.startTimeIso).toBe(
    '2024-01-02T03:04:05.000Z',
  );
  const dateIso = result.caseDetail.columns.dateIso;
  expect(typeof dateIso).toBe('string');
  if (typeof dateIso === 'string') {
    expect(new Date(dateIso).getTime()).toBeGreaterThanOrEqual(
      new Date('2024-01-02T03:04:05.000Z').getTime(),
    );
  }
  expect(result.caseDetail.trace[0]).toMatchObject({
    startedAt: '2024-01-02T03:04:05.000Z',
  });
  expect(
    new Date(result.caseDetail.trace[0]?.endedAt ?? '').getTime(),
  ).toBeGreaterThanOrEqual(new Date('2024-01-02T03:04:05.000Z').getTime());
});

test('runCase can opt an eval back into the real current clock', async () => {
  const beforeRun = Date.now();
  const result = await runClockCase({
    id: 'clock-eval',
    startTime: 'now',
    execute: () => {
      setEvalOutput('startTimeMs', getEvalStartTime().getTime());
      setEvalOutput('dateNow', Date.now());
    },
  });
  const afterRun = Date.now();

  const dateNow = result.caseDetail.columns.dateNow;
  const startTimeMs = result.caseDetail.columns.startTimeMs;
  expect(typeof dateNow).toBe('number');
  expect(typeof startTimeMs).toBe('number');
  if (typeof dateNow === 'number' && typeof startTimeMs === 'number') {
    expect(startTimeMs).toBeGreaterThanOrEqual(beforeRun);
    expect(startTimeMs).toBeLessThanOrEqual(afterRun);
    expect(dateNow).toBeGreaterThanOrEqual(beforeRun);
    expect(dateNow).toBeLessThanOrEqual(afterRun);
  }
});
