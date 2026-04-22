import type { RepoFileRef } from '@agent-evals/shared';

/**
 * Create a file reference that can be emitted via `setOutput(...)` and rendered
 * by a column configured with `format: 'image' | 'audio' | 'video' | 'file'`.
 *
 * @param path Relative or absolute path to the repository file.
 * @param mimeType Optional MIME type hint for UI rendering.
 * @returns A repo-backed file reference suitable for file/media columns.
 */
export function repoFile(path: string, mimeType?: string): RepoFileRef {
  return { source: 'repo', path, mimeType };
}
