import type { RepoFileRef } from '@agent-evals/shared';

/**
 * Create a file reference that can be emitted via `setEvalOutput(...)` and rendered
 * by a column configured with `format: 'image' | 'html' | 'pdf' | 'audio' |
 * 'video' | 'file'`.
 *
 * @param path Relative or absolute path to the repository file.
 * @param mimeType Optional MIME type hint for UI rendering.
 * @param sizeBytes Optional file size hint shown by artifact cards in the UI.
 * @returns A repo-backed file reference suitable for file/media columns.
 */
export function repoFile(
  path: string,
  mimeType?: string,
  sizeBytes?: number,
): RepoFileRef {
  return { source: 'repo', path, mimeType, sizeBytes };
}
