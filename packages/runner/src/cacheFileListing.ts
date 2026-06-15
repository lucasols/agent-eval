import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resultify } from 't-result';

export const cacheEntryExtension = '.json.br';
export const debugEntryExtension = '.json';
export const cacheIndexFilePrefix = '.index-';

export async function listCacheEntryFiles(
  rootDir: string,
  scope: 'allNamespaces' | 'namespace',
): Promise<string[]> {
  if (scope === 'namespace') {
    return listDirectFilesWithExtension(rootDir, cacheEntryExtension);
  }

  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];

  const files: string[] = [];
  for (const entry of entriesResult.value) {
    if (!entry.isDirectory()) continue;
    files.push(
      ...(await listDirectFilesWithExtension(
        join(rootDir, entry.name),
        cacheEntryExtension,
      )),
    );
  }
  return files;
}

export async function listDebugEntryFiles(rootDir: string): Promise<string[]> {
  return listFilesWithExtension(rootDir, debugEntryExtension);
}

export async function listCacheIndexFiles(rootDir: string): Promise<string[]> {
  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];
  return entriesResult.value
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(cacheIndexFilePrefix) &&
        entry.name.endsWith(debugEntryExtension),
    )
    .map((entry) => join(rootDir, entry.name));
}

export async function removeDirIfEmpty(dirPath: string): Promise<void> {
  const entriesResult = await resultify(() => readdir(dirPath));
  if (entriesResult.error || entriesResult.value.length > 0) return;
  await rm(dirPath, { recursive: true, force: true });
}

async function listDirectFilesWithExtension(
  rootDir: string,
  extension: string,
): Promise<string[]> {
  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];
  return entriesResult.value
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(rootDir, entry.name));
}

async function listFilesWithExtension(
  rootDir: string,
  extension: string,
): Promise<string[]> {
  if (!existsSync(rootDir)) return [];
  const entriesResult = await resultify(() =>
    readdir(rootDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];
  const files: string[] = [];
  for (const entry of entriesResult.value) {
    const filePath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesWithExtension(filePath, extension)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(filePath);
    }
  }
  return files;
}
