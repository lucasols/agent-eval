function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read a value from `source` by walking a dot-separated path.
 *
 * Returns `undefined` when any segment of the path is missing or when an
 * intermediate value is not a plain object. Used by trace-attribute display,
 * the LLM calls extractor, and any consumer that needs to look up nested
 * properties from a span's `attributes` record.
 */
export function getNestedAttribute(value: unknown, path: string): unknown {
  const parts = path.split('.');
  let current = value;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}
