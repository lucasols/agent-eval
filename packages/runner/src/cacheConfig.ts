import type { AgentEvalsConfig } from '@agent-evals/shared';

export function getCacheRetentionOptions(
  cacheConfig: AgentEvalsConfig['cache'],
): {
  maxEntriesPerNamespace: number | undefined;
  maxEntriesByNamespace: Record<string, number> | undefined;
} {
  const maxEntries = cacheConfig?.maxEntries;
  if (typeof maxEntries === 'number') {
    return {
      maxEntriesPerNamespace: maxEntries,
      maxEntriesByNamespace: undefined,
    };
  }

  return {
    maxEntriesPerNamespace: maxEntries?.default,
    maxEntriesByNamespace: maxEntries?.namespaces,
  };
}
