const CHECKPOINT_PREVIEW_MAX_LEN = 80;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build a single-line, length-bounded preview of a checkpoint's captured value
 * for inline display in the trace tree. Truncates with an ellipsis when the
 * formatted string would exceed `CHECKPOINT_PREVIEW_MAX_LEN`.
 */
export function formatCheckpointPreview(value: unknown): string {
  const inner = formatPreviewValue(value, 0);
  if (inner.length <= CHECKPOINT_PREVIEW_MAX_LEN) return inner;
  return `${inner.slice(0, CHECKPOINT_PREVIEW_MAX_LEN - 1)}…`;
}

function formatPreviewValue(value: unknown, depth: number): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (typeof value === 'symbol' || typeof value === 'function') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    if (depth > 0) return `[${String(value.length)}]`;
    if (value.length === 0) return '[]';
    return `[${String(value.length)} items]`;
  }
  if (isPlainObject(value)) {
    if (depth > 0) return '{…}';
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v]) => `${k}: ${formatPreviewValue(v, depth + 1)}`)
      .join(', ');
  }
  return Object.prototype.toString.call(value);
}
