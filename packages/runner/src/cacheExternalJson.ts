import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import {
  materializeExternalJsonValues,
  type CacheSerializationExternalJsonStore,
} from '@agent-evals/sdk';
import { cacheRecordingSchema, type CacheEntry } from '@agent-evals/shared';
import { resultify } from 't-result';
import {
  compareExternalJsonBlobFile,
  type ExternalJsonBlobFile,
} from './cacheCleanupLogging.ts';

const cacheSerializationMarker = '__aecs';
const supportedCacheSerializationPrefix = 'v1:';
const externalJsonCacheSerializationMarker = 'v1:ExternalJson';
const externalJsonBlobExtension = '.json.br';

export const externalJsonBlobDirName = 'cache-blobs';

export type ExternalJsonBlobIndex = {
  entries: Record<string, { blobRefs: string[] }>;
};

export function usesSupportedCacheSerialization(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(usesSupportedCacheSerialization);
  }
  if (!isRecordLike(value)) return true;
  if (
    Object.hasOwn(value, cacheSerializationMarker) &&
    (typeof value[cacheSerializationMarker] !== 'string' ||
      !value[cacheSerializationMarker].startsWith(
        supportedCacheSerializationPrefix,
      ))
  ) {
    return false;
  }
  return Object.values(value).every(usesSupportedCacheSerialization);
}

export function createExternalJsonBlobStore(params: {
  primaryDir: string;
  fallbackDirs: readonly string[];
}): CacheSerializationExternalJsonStore {
  return {
    async write(rawJson) {
      const rawBytes = Buffer.from(rawJson, 'utf8');
      const hash = hashExternalJson(rawBytes);
      const path = externalJsonBlobPath(hash);
      const compressed = brotliCompressSync(rawBytes);
      const filePath = resolveStorePath(params.primaryDir, path);

      if (!existsSync(filePath)) {
        await writeAtomicFile(filePath, compressed);
      }

      return {
        compressedLength: compressed.byteLength,
        hash,
        length: rawBytes.byteLength,
        path,
      };
    },

    async read(ref) {
      for (const dir of [params.primaryDir, ...params.fallbackDirs]) {
        const compressedResult = await resultify(() =>
          readFile(resolveStorePath(dir, ref.path)),
        );
        if (compressedResult.error) continue;
        const rawBytesResult = resultify(() =>
          brotliDecompressSync(compressedResult.value),
        );
        if (rawBytesResult.error) continue;
        const rawBytes = rawBytesResult.value;
        if (
          rawBytes.byteLength === ref.length &&
          hashExternalJson(rawBytes) === ref.hash
        ) {
          return rawBytes.toString('utf8');
        }
      }
      throw new Error(
        `External cache blob failed integrity check: ${ref.hash}`,
      );
    },
  };
}

export function resolveStorePath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`External cache blob path escapes store: ${relativePath}`);
  }
  return path;
}

export async function materializeExternalJsonCacheEntryOrNull(
  entry: CacheEntry,
  store: CacheSerializationExternalJsonStore,
): Promise<CacheEntry | null> {
  const result = await resultify(() =>
    materializeExternalJsonCacheEntry(entry, store),
  );
  return result.error ? null : result.value;
}

export async function collectExternalJsonBlobRefs(
  value: unknown,
  blobDirs: readonly string[],
): Promise<string[]> {
  const paths = new Set<string>();
  const pendingBlobPaths: string[] = [];
  collectExternalJsonBlobPaths(value, paths, pendingBlobPaths);

  while (pendingBlobPaths.length > 0) {
    const blobPath = pendingBlobPaths.pop();
    if (blobPath === undefined) continue;
    const rawJson = await readExternalJsonBlobByPath(blobDirs, blobPath);
    if (rawJson === null) continue;
    const json = safeJsonParse(rawJson);
    if (json === null) continue;
    collectExternalJsonBlobPaths(json, paths, pendingBlobPaths);
  }

  return [...paths].sort();
}

export async function pruneUnreferencedExternalJsonBlobs(params: {
  indexes: readonly ExternalJsonBlobIndex[];
  blobDirs: readonly string[];
}): Promise<ExternalJsonBlobFile[]> {
  const removedFiles: ExternalJsonBlobFile[] = [];
  const referenced = collectReferencedExternalJsonBlobPaths(params.indexes);
  for (const blobDir of params.blobDirs) {
    if (!existsSync(blobDir)) continue;
    for (const path of await listExternalJsonBlobPaths(blobDir)) {
      if (!referenced.has(path)) {
        const filePath = resolveStorePath(blobDir, path);
        await rm(filePath, { force: true });
        removedFiles.push({ blobDir, filePath, path });
      }
    }
  }
  return removedFiles.toSorted(compareExternalJsonBlobFile);
}

export async function listExternalJsonBlobPaths(
  blobDir: string,
): Promise<string[]> {
  const paths: string[] = [];
  await collectExternalJsonBlobFilePaths(blobDir, blobDir, paths);
  return paths.toSorted();
}

export async function listExternalJsonBlobFiles(
  blobDirs: readonly string[],
): Promise<ExternalJsonBlobFile[]> {
  const files: ExternalJsonBlobFile[] = [];
  for (const blobDir of blobDirs) {
    if (!existsSync(blobDir)) continue;
    for (const path of await listExternalJsonBlobPaths(blobDir)) {
      files.push({ blobDir, filePath: resolveStorePath(blobDir, path), path });
    }
  }
  return files.toSorted(compareExternalJsonBlobFile);
}

async function materializeExternalJsonCacheEntry(
  entry: CacheEntry,
  store: CacheSerializationExternalJsonStore,
): Promise<CacheEntry> {
  return {
    ...entry,
    recording: cacheRecordingSchema.parse(
      await materializeExternalJsonValues(entry.recording, store),
    ),
  };
}

function hashExternalJson(rawBytes: Buffer): `sha256:${string}` {
  const digest = createHash('sha256').update(rawBytes).digest('hex');
  return `sha256:${digest}`;
}

function externalJsonBlobPath(hash: `sha256:${string}`): string {
  const digest = hash.slice('sha256:'.length);
  return join(
    'sha256',
    digest.slice(0, 2),
    `${digest}${externalJsonBlobExtension}`,
  );
}

function collectReferencedExternalJsonBlobPaths(
  indexes: readonly ExternalJsonBlobIndex[],
): Set<string> {
  const paths = new Set<string>();
  for (const index of indexes) {
    for (const entry of Object.values(index.entries)) {
      for (const blobRef of entry.blobRefs) {
        paths.add(blobRef);
      }
    }
  }
  return paths;
}

function collectExternalJsonBlobPaths(
  value: unknown,
  paths: Set<string>,
  pendingBlobPaths: string[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExternalJsonBlobPaths(item, paths, pendingBlobPaths);
    }
    return;
  }
  if (!isRecordLike(value)) return;
  if (
    value[cacheSerializationMarker] === externalJsonCacheSerializationMarker &&
    typeof value.path === 'string'
  ) {
    if (!paths.has(value.path)) {
      paths.add(value.path);
      pendingBlobPaths.push(value.path);
    }
  }
  for (const entryValue of Object.values(value)) {
    collectExternalJsonBlobPaths(entryValue, paths, pendingBlobPaths);
  }
}

async function readExternalJsonBlobByPath(
  blobDirs: readonly string[],
  path: string,
): Promise<string | null> {
  for (const blobDir of blobDirs) {
    const compressedResult = await resultify(() =>
      readFile(resolveStorePath(blobDir, path)),
    );
    if (compressedResult.error) continue;
    const rawResult = resultify(() =>
      brotliDecompressSync(compressedResult.value).toString('utf8'),
    );
    if (!rawResult.error) return rawResult.value;
  }
  return null;
}

async function collectExternalJsonBlobFilePaths(
  root: string,
  dir: string,
  paths: string[],
): Promise<void> {
  const entriesResult = await resultify(() =>
    readdir(dir, { withFileTypes: true }),
  );
  if (entriesResult.error) return;
  for (const entry of entriesResult.value) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectExternalJsonBlobFilePaths(root, path, paths);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(externalJsonBlobExtension)) {
      paths.push(relative(root, path));
    }
  }
}

async function writeAtomicFile(
  filePath: string,
  contents: string | Buffer,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid.toString()}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, contents);
  await rename(tmpPath, filePath);
}

function safeJsonParse(text: string): unknown {
  const parsed = resultify((): unknown => JSON.parse(text));
  if (parsed.error) return null;
  return parsed.value;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
