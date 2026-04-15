import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CacheRuntime } from '@agent-evals/sdk';

function safeJsonParse(raw: string): unknown {
  const result: unknown = JSON.parse(raw);
  return result;
}

function isCacheEntry<T>(value: unknown): value is { response: T } {
  return (
    typeof value === 'object' && value !== null && 'response' in value
  );
}

function parseCacheEntry<T>(raw: string): { response: T } {
  const parsed = safeJsonParse(raw);
  if (!isCacheEntry<T>(parsed)) {
    throw new Error('Invalid cache entry format');
  }
  return parsed;
}

export type CacheManager = {
  createCacheRuntime(disabled: boolean): CacheRuntime;
};

function computeCacheKey(keyParts: unknown): string {
  const canonical = JSON.stringify(keyParts, Object.keys(typeof keyParts === 'object' && keyParts !== null ? keyParts : {}).sort());
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `sha256_${hash.slice(0, 16)}`;
}

export function createCacheManager(cacheDir: string): CacheManager {
  return {
    createCacheRuntime(disabled: boolean): CacheRuntime {
      return {
        async getOrSet<T>(params: {
          namespace: string;
          keyParts: unknown;
          metadata?: Record<string, unknown>;
          producer: () => Promise<T>;
        }): Promise<{ value: T; status: 'hit' | 'miss'; key: string }> {
          const key = computeCacheKey(params.keyParts);

          if (disabled) {
            const value = await params.producer();
            return { value, status: 'miss', key };
          }

          const nsDir = join(cacheDir, params.namespace);
          const filePath = join(nsDir, `${key}.json`);

          if (existsSync(filePath)) {
            const raw = await readFile(filePath, 'utf-8');
            const entry = parseCacheEntry<T>(raw);
            return { value: entry.response, status: 'hit', key };
          }

          const value = await params.producer();

          await mkdir(nsDir, { recursive: true });
          const entry = {
            schemaVersion: 1,
            namespace: params.namespace,
            key,
            request: params.keyParts,
            response: value,
            meta: {
              createdAt: new Date().toISOString(),
              ...params.metadata,
            },
          };
          await writeFile(filePath, JSON.stringify(entry, null, 2));

          return { value, status: 'miss', key };
        },
      };
    },
  };
}
