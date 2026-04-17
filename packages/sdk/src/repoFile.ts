import type { RepoFileRef } from '@agent-evals/shared';

/**
 * Create a display-safe reference to a file that lives in the eval workspace.
 *
 * @param path Relative or absolute path to the repository file.
 * @param mimeType Optional MIME type hint for UI rendering.
 * @returns A repo-backed file reference consumable by display blocks.
 */
export function repoFile(path: string, mimeType?: string): RepoFileRef {
  return {
    source: 'repo',
    path,
    mimeType,
  };
}
