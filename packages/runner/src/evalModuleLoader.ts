import { pathToFileURL } from 'node:url';

/**
 * Import one eval module with a cache key derived from its current source so
 * repeated discovery and runs observe the latest authored definition.
 */
export async function loadEvalModule(
  filePath: string,
  sourceFingerprint: string | undefined = undefined,
): Promise<void> {
  const moduleUrl = new URL(pathToFileURL(filePath).href);
  if (sourceFingerprint !== undefined) {
    moduleUrl.searchParams.set('v', sourceFingerprint);
  }
  await import(moduleUrl.href);
}
