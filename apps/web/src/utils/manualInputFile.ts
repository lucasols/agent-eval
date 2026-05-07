import { Result, resultify } from 't-result';
import { apiUrl } from '#src/utils/apiUrl';

/**
 * Runtime value produced by the manual-input file widget. Mirrors the SDK's
 * `ManualInputFileValue` type so the web bundle does not need a runtime
 * dependency on the SDK package.
 */
export type ManualInputFileValue = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  path: string;
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
    typeof candidate.sizeBytes === 'number' &&
    typeof candidate.sha256 === 'string' &&
    typeof candidate.path === 'string'
  );
}

/**
 * Upload a `File` object into the workspace staging area and return the
 * artifact-backed manual-input file value expected by the run API.
 */
export async function uploadFileAsManualInputValue(
  file: File,
): Promise<Result<ManualInputFileValue, Error>> {
  const formData = new FormData();
  formData.set('file', file);
  const responseResult = await resultify(() =>
    fetch(apiUrl('/api/manual-input-files'), {
      method: 'POST',
      body: formData,
    }),
  );
  if (responseResult.error) return responseResult.errorResult();

  const jsonResult = await resultify(
    async (): Promise<unknown> => await responseResult.value.json(),
  );
  if (jsonResult.error) return jsonResult.errorResult();
  if (!responseResult.value.ok) {
    const message =
      typeof jsonResult.value === 'object' &&
      jsonResult.value !== null &&
      'error' in jsonResult.value &&
      typeof jsonResult.value.error === 'string'
        ? jsonResult.value.error
        : 'File upload failed';
    return Result.err(new Error(message));
  }
  if (!isManualInputFileValue(jsonResult.value)) {
    return Result.err(new Error('Server returned an invalid file value'));
  }
  return Result.ok(jsonResult.value);
}

/** Build a browser URL for a staged or persisted manual-input file. */
export function getManualInputFileUrl(value: ManualInputFileValue): string {
  const params = new URLSearchParams({ path: value.path });
  if (value.mimeType) {
    params.set('mimeType', value.mimeType);
  }
  return apiUrl(`/api/repo-file?${params.toString()}`);
}

/** Format bytes as a human-readable string (e.g. `1.4 MB`, `820 KB`). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
