import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CacheMode } from '@agent-evals/shared';
import type { CacheRuntime } from '@agent-evals/sdk';

export type CacheManager = {
  createCacheRuntime(mode: CacheMode): CacheRuntime;
};

function computeCacheKey(keyParts: unknown): string {
  const canonical = JSON.stringify(keyParts, Object.keys(typeof keyParts === 'object' && keyParts !== null ? keyParts : {}).sort());
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `sha256_${hash.slice(0, 16)}`;
}

export function createCacheManager(
  localStateDir: string,
  recordedCacheDir: string,
): CacheManager {
  const localCacheDir = join(localStateDir, 'cache', 'local');
  const recordedDir = join(recordedCacheDir, 'cache');

  return {
    createCacheRuntime(mode: CacheMode): CacheRuntime {
      return {
        async getOrSet<T>(params: {
          namespace: string;
          keyParts: unknown;
          metadata?: Record<string, unknown>;
          producer: () => Promise<T>;
        }): Promise<{ value: T; status: 'hit' | 'miss'; key: string }> {
          const key = computeCacheKey(params.keyParts);
          const nsDir = (dir: string) => join(dir, params.namespace);
          const filePath = (dir: string) => join(nsDir(dir), `${key}.json`);

          if (mode === 'off') {
            const value = await params.producer();
            return { value, status: 'miss', key };
          }

          if (mode === 'local') {
            const localPath = filePath(localCacheDir);
            if (existsSync(localPath)) {
              const raw = await readFile(localPath, 'utf-8');
              const entry = JSON.parse(raw) as { response: T };
              return { value: entry.response, status: 'hit', key };
            }

            const value = await params.producer();

            await mkdir(nsDir(localCacheDir), { recursive: true });
            const entry = {
              schemaVersion: 1,
              namespace: params.namespace,
              key,
              request: params.keyParts,
              response: value,
              meta: {
                createdAt: new Date().toISOString(),
                mode: 'local',
                ...params.metadata,
              },
            };
            await writeFile(localPath, JSON.stringify(entry, null, 2));

            return { value, status: 'miss', key };
          }

          if (mode === 'recorded' || mode === 'readonly-recorded') {
            const recordedPath = filePath(recordedDir);
            if (existsSync(recordedPath)) {
              const raw = await readFile(recordedPath, 'utf-8');
              const entry = JSON.parse(raw) as { response: T };
              return { value: entry.response, status: 'hit', key };
            }

            if (mode === 'readonly-recorded') {
              throw new Error(
                `Cache miss in readonly-recorded mode: namespace=${params.namespace}, key=${key}`,
              );
            }

            const value = await params.producer();

            await mkdir(nsDir(recordedDir), { recursive: true });
            const entry = {
              schemaVersion: 1,
              namespace: params.namespace,
              key,
              request: params.keyParts,
              response: value,
              meta: {
                createdAt: new Date().toISOString(),
                mode: 'recorded',
                ...params.metadata,
              },
            };
            await writeFile(recordedPath, JSON.stringify(entry, null, 2));

            return { value, status: 'miss', key };
          }

          const value = await params.producer();
          return { value, status: 'miss', key };
        },
      };
    },
  };
}
