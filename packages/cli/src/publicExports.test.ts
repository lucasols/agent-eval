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
