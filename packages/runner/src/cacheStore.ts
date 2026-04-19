import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resultify } from 't-result';
import { cacheEntrySchema, type CacheListItem } from '@agent-evals/shared';
import type { CacheAdapter } from '@agent-evals/sdk';

/** Filter accepted by `FsCacheStore.clear` to narrow the set of entries removed. */
export type CacheClearFilter = {
  namespace?: string;
  key?: string;
};

/** Filesystem cache adapter backing persisted cache entries for a workspace. */
export type FsCacheStore = CacheAdapter & {
  /** Walk the cache directory and return a summary row per stored entry. */
  list(): Promise<CacheListItem[]>;
  /** Delete entries matching `filter`, or all entries when no filter is given. */
  clear(filter?: CacheClearFilter): Promise<void>;
  /** Resolve the on-disk directory used for cache entries. */
  dir(): string;
};

/**
 * Create a filesystem-backed cache adapter rooted at `<workspaceRoot>/<dir>`.
 *
 * Writes use `<name>.tmp` + atomic `rename` to avoid partial reads under
 * concurrent access.
 */
export function createFsCacheStore(options: {
  workspaceRoot: string;
  dir?: string;
}): FsCacheStore {
  const cacheDir = resolve(
    options.workspaceRoot,
    options.dir ?? '.agent-evals/cache',
  );

  return {
    dir() {
      return cacheDir;
    },

    async lookup(namespace, keyHash) {
      const filePath = entryPath(cacheDir, namespace, keyHash);
      if (!existsSync(filePath)) return null;
      const raw = await readFile(filePath, 'utf-8');
      const json: unknown = safeJsonParse(raw);
      if (json === null) return null;
      const parsed = cacheEntrySchema.safeParse(json);
      if (!parsed.success) return null;
      return parsed.data;
    },

    async write(entry) {
      const filePath = entryPath(cacheDir, entry.namespace, entry.key);
      await mkdir(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${process.pid.toString()}.tmp`;
      await writeFile(tmpPath, JSON.stringify(entry));
      await rename(tmpPath, filePath);
    },

    async list() {
      if (!existsSync(cacheDir)) return [];
      const namespaces = await readdir(cacheDir);
      const items: CacheListItem[] = [];
      for (const namespace of namespaces) {
        const nsPath = join(cacheDir, namespace);
        const nsStat = await stat(nsPath);
        if (!nsStat.isDirectory()) continue;
        const files = await readdir(nsPath);
        for (const fileName of files) {
          if (!fileName.endsWith('.json')) continue;
          const filePath = join(nsPath, fileName);
          const raw = await readFile(filePath, 'utf-8');
          const json: unknown = safeJsonParse(raw);
          if (json === null) continue;
          const parsed = cacheEntrySchema.safeParse(json);
          if (!parsed.success) continue;
          const fileStat = await stat(filePath);
          items.push({
            key: parsed.data.key,
            namespace: parsed.data.namespace,
            spanName: parsed.data.spanName,
            spanKind: parsed.data.spanKind,
            storedAt: parsed.data.storedAt,
            codeFingerprint: parsed.data.codeFingerprint,
            sizeBytes: fileStat.size,
          });
        }
      }
      items.sort((a, b) => (a.storedAt < b.storedAt ? 1 : -1));
      return items;
    },

    async clear(filter) {
      if (!existsSync(cacheDir)) return;
      if (
        !filter
        || (filter.namespace === undefined && filter.key === undefined)
      ) {
        await rm(cacheDir, { recursive: true, force: true });
        return;
      }
      if (filter.namespace !== undefined && filter.key === undefined) {
        const nsPath = join(cacheDir, filter.namespace);
        await rm(nsPath, { recursive: true, force: true });
        return;
      }
      if (filter.namespace !== undefined && filter.key !== undefined) {
        const filePath = entryPath(cacheDir, filter.namespace, filter.key);
        await rm(filePath, { force: true });
        return;
      }
      // key-only filter: find it across namespaces
      const namespaces = await readdir(cacheDir);
      for (const namespace of namespaces) {
        const filePath = entryPath(cacheDir, namespace, filter.key ?? '');
        if (existsSync(filePath)) {
          await rm(filePath, { force: true });
        }
      }
    },
  };
}

function entryPath(
  cacheDir: string,
  namespace: string,
  keyHash: string,
): string {
  return join(cacheDir, sanitizeSegment(namespace), `${keyHash}.json`);
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function safeJsonParse(text: string): unknown {
  const parsed = resultify((): unknown => JSON.parse(text));
  if (parsed.error) return null;
  return parsed.value;
}
