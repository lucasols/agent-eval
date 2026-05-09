import { Result } from 't-result';
import { z } from 'zod/v4';
import { apiClient, getRpcResult } from '#src/api/client';
import { apiUrl } from '#src/utils/apiUrl';

const manualInputFileValueSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  path: z.string(),
});

/**
 * Runtime value produced by the manual-input file widget. Mirrors the SDK's
 * `ManualInputFileValue` type so the web bundle does not need a runtime
 * dependency on the SDK package.
 */
export type ManualInputFileValue = z.infer<typeof manualInputFileValueSchema>;

/** True when `value` looks like the wire-format payload of a file widget. */
export function isManualInputFileValue(
  value: unknown,
): value is ManualInputFileValue {
  return manualInputFileValueSchema.safeParse(value).success;
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
  const responseResult = await getRpcResult(
    apiClient.api['manual-input-files'].$post(undefined, {
      init: { body: formData },
    }),
  );
  if (responseResult.error) {
    return Result.err(new Error(responseResult.error.message));
  }
  const parsed = manualInputFileValueSchema.safeParse(responseResult.value);
  if (!parsed.success) {
    return Result.err(new Error('Upload response did not match schema'));
  }
  return Result.ok(parsed.data);
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
