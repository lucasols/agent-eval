import type { AgentEvalsConfig } from '@agent-evals/shared';

export function getCacheRetentionOptions(
  cacheConfig: AgentEvalsConfig['cache'],
): {
  maxBytesPerNamespace: number | undefined;
  maxBytesByNamespace: Record<string, number> | undefined;
} {
  const maxBytes = cacheConfig?.maxBytes;
  if (typeof maxBytes === 'number') {
    return { maxBytesPerNamespace: maxBytes, maxBytesByNamespace: undefined };
  }

  return {
    maxBytesPerNamespace: maxBytes?.default,
    maxBytesByNamespace: maxBytes?.namespaces,
  };
}
