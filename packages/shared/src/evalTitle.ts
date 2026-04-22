type EvalTitleLike = { id: string; title?: string };

function humanizeEvalId(id: string): string {
  const normalized = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_\s]+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return id;
  }

  return normalized
    .split(' ')
    .map((segment) => {
      const firstChar = segment.slice(0, 1);
      const remainder = segment.slice(1);
      return `${firstChar.toUpperCase()}${remainder}`;
    })
    .join(' ');
}

/**
 * Resolve the display title for an eval.
 *
 * Returns the authored `title` when present; otherwise derives a human-readable
 * label from the stable eval `id` so display surfaces can avoid repeating both
 * fields in common cases.
 */
export function getEvalTitle(evalLike: EvalTitleLike): string {
  if (evalLike.title !== undefined) {
    return evalLike.title;
  }

  return humanizeEvalId(evalLike.id);
}
