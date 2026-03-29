import type { RepoFileRef } from '@agent-evals/shared';

export function repoFile(path: string, mimeType?: string): RepoFileRef {
  return {
    source: 'repo',
    path,
    mimeType,
  };
}
