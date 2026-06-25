import type { AgentEvalsConfig } from '@agent-evals/shared';

/** Default durable cache directory, relative to the workspace root. */
export const defaultCacheDir = '.agent-evals/cache';
/** Default durable raw-key debug directory, relative to the workspace root. */
export const defaultCacheDebugDir = '.agent-evals/cache-debug';
/** Default temporary cache directory, relative to the workspace root. */
export const defaultTemporaryCacheDir = '.agent-evals/tmp/cache';
/** Default temporary raw-key debug directory, relative to the workspace root. */
export const defaultTemporaryCacheDebugDir = '.agent-evals/tmp/cache-debug';

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

export function getCacheStoreOptions(cacheConfig: AgentEvalsConfig['cache']): {
  dir: string | undefined;
  temporaryDir: string;
  temporaryDebugDir: string;
} {
  return {
    dir: cacheConfig?.dir,
    temporaryDir: defaultTemporaryCacheDir,
    temporaryDebugDir: defaultTemporaryCacheDebugDir,
  };
}
