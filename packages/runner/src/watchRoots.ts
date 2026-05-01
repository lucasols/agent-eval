import { dirname, resolve } from 'node:path';

const globMagicCharacters = new Set([
  '*',
  '?',
  '[',
  ']',
  '{',
  '}',
  '(',
  ')',
  '!',
  '+',
  '@',
]);

function hasGlobMagic(value: string): boolean {
  for (const char of value) {
    if (globMagicCharacters.has(char)) return true;
  }
  return false;
}

function getWatchRootForIncludePattern(params: {
  pattern: string;
  workspaceRoot: string;
}): string {
  const normalizedPattern = params.pattern.replaceAll('\\', '/');
  const segments = normalizedPattern.split('/').filter((part) => part !== '');
  const firstGlobSegmentIndex = segments.findIndex(hasGlobMagic);

  if (firstGlobSegmentIndex === -1) {
    return dirname(resolve(params.workspaceRoot, params.pattern));
  }

  if (firstGlobSegmentIndex === 0) return params.workspaceRoot;

  return resolve(
    params.workspaceRoot,
    segments.slice(0, firstGlobSegmentIndex).join('/'),
  );
}

export function getWatchRootsForIncludePatterns(params: {
  patterns: string[];
  workspaceRoot: string;
}): string[] {
  const roots = new Set<string>();

  for (const pattern of params.patterns) {
    roots.add(
      getWatchRootForIncludePattern({
        pattern,
        workspaceRoot: params.workspaceRoot,
      }),
    );
  }

  if (roots.size === 0) return [params.workspaceRoot];
  return [...roots];
}
