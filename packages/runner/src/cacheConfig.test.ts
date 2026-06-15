import { describe, expect, test } from 'vitest';
import { getCacheRetentionOptions } from './cacheConfig.ts';

describe('cache retention config', () => {
  test('uses maxBytes as the default per-namespace byte cap', () => {
    expect(getCacheRetentionOptions({ maxBytes: 1024 })).toEqual({
      maxBytesPerNamespace: 1024,
      maxBytesByNamespace: undefined,
    });
  });

  test('uses maxBytes object form for namespace overrides', () => {
    expect(
      getCacheRetentionOptions({
        maxBytes: { default: 1024, namespaces: { 'eval.operation': 2048 } },
      }),
    ).toEqual({
      maxBytesPerNamespace: 1024,
      maxBytesByNamespace: { 'eval.operation': 2048 },
    });
  });
});
