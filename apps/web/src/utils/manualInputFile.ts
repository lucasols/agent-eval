import { Result, resultify } from 't-result';

/**
 * Runtime value produced by the manual-input file widget. Mirrors the SDK's
 * `ManualInputFileValue` type so the web bundle does not need a runtime
 * dependency on the SDK package.
 */
export type ManualInputFileValue = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

/** True when `value` looks like the wire-format payload of a file widget. */
export function isManualInputFileValue(
  value: unknown,
): value is ManualInputFileValue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.dataUrl === 'string'
  );
}

/**
 * Read a `File` object as a base64 `data:` URL and assemble the wire-format
 * value the manual-input file widget expects. The returned `Result` carries
 * the underlying `FileReader` error so callers can surface it inline.
 */
export async function readFileAsManualInputValue(
  file: File,
): Promise<Result<ManualInputFileValue, Error>> {
  const reader = new FileReader();
  const dataUrlResult = await new Promise<Result<string, Error>>((resolve) => {
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string') {
        resolve(Result.err(new Error('FileReader returned a non-string')));
        return;
      }
      resolve(Result.ok(value));
    };
    reader.onerror = () => {
      const err = reader.error ?? new Error('FileReader failed');
      resolve(Result.err(err));
    };
    const started = resultify(() => reader.readAsDataURL(file));
    if (started.error) resolve(started.errorResult());
  });
  if (dataUrlResult.error) return dataUrlResult.errorResult();
  return Result.ok({
    name: file.name,
    mimeType: file.type,
    size: file.size,
    dataUrl: dataUrlResult.value,
  });
}

/** Format bytes as a human-readable string (e.g. `1.4 MB`, `820 KB`). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
