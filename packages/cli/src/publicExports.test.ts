import { describe, expect, it } from 'vitest';
import * as publicApi from './index.ts';

describe('public package exports', () => {
  it('does not expose internal shared schemas', () => {
    const apiExports: Record<string, unknown> = publicApi;
    const schemaExports = Object.keys(apiExports).filter((key) =>
      key.endsWith('Schema'),
    );

    expect(schemaExports).toEqual(['manualInputFileValueSchema']);
    expect(Object.hasOwn(apiExports, 'z')).toBe(false);
    expect(Object.hasOwn(apiExports, 'evalChartAxisSchema')).toBe(false);
    expect(Object.hasOwn(apiExports, 'createRunRequestSchema')).toBe(false);
  });
});

describe('runtime package exports', () => {
  it('shares the helpers of the main entry', async () => {
    const runtimeApi: Record<string, unknown> = await import('./runtime.ts');
    const apiExports: Record<string, unknown> = publicApi;
    const notShared = Object.keys(runtimeApi).filter(
      (key) => runtimeApi[key] !== apiExports[key],
    );

    expect(notShared).toEqual([]);
    expect(Object.keys(runtimeApi).sort()).toMatchInlineSnapshot(`
      [
        "EvalAssertionError",
        "EvalRuntimeUsageError",
        "appendToEvalOutput",
        "captureEvalSpanError",
        "evalAssert",
        "evalExpect",
        "evalLog",
        "evalSpan",
        "evalTime",
        "evalTracer",
        "getCurrentScope",
        "getEvalCaseInput",
        "incrementEvalOutput",
        "isInEvalScope",
        "matchesEvalTags",
        "mergeEvalOutput",
        "nextEvalId",
        "setEvalOutput",
        "startEvalBackgroundJob",
      ]
    `);
  });
});
