import { Blob, File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod/v4';
import type { ManualInputFileValue } from './types.ts';

/**
 * Zod schema describing one file uploaded through the manual-input modal.
 *
 * Use this as the field type on your `manualInput.schema` whenever you mark
 * a field with `{ asFile: true }` in `manualInput.fields`. The UI / CLI stages
 * the selected file on disk, the runner materializes it into the run artifacts
 * directory, and the server validates this JSON metadata against the schema
 * before flowing it into the case input.
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   image: manualInputFileValueSchema,
 *   note: z.string().optional(),
 * });
 *
 * defineEval({
 *   id: 'image-analyzer',
 *   manualInput: {
 *     schema,
 *     fields: { image: { asFile: true, accept: 'image/*' } },
 *   },
 *   // ...
 * });
 * ```
 */
export const manualInputFileValueSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string().min(1),
}) satisfies z.ZodType<ManualInputFileValue>;

/** Resolved file content and convenience views for a manual-input file. */
export type ReadManualInputFileResult = {
  /** Metadata supplied to the eval input. */
  value: ManualInputFileValue;
  /** Absolute path resolved from {@link ManualInputFileValue.path}. */
  absolutePath: string;
  /** Raw file bytes. */
  bytes: Uint8Array;
  /** Copy of {@link bytes} as an `ArrayBuffer`. */
  arrayBuffer: ArrayBuffer;
  /** Bytes wrapped as a `Blob` with the input MIME type. */
  blob: Blob;
  /** Bytes wrapped as a `File` with the input name and MIME type. */
  file: File;
  /** Decode the file bytes as UTF-8 text. */
  text: () => Promise<string>;
  /** Parse the file bytes as JSON. */
  json: () => Promise<unknown>;
};

/**
 * Read a manual-input file artifact from disk and expose common byte, Blob,
 * File, text, and JSON views for eval code.
 *
 * @param value Manual-input file metadata received by an eval.
 * @param options.cwd Directory used to resolve relative paths. Defaults to `process.cwd()`.
 * @returns File bytes plus convenience views for common file-processing flows.
 */
export async function readManualInputFile(
  value: ManualInputFileValue,
  options: { cwd?: string } = {},
): Promise<ReadManualInputFileResult> {
  const absolutePath = resolve(options.cwd ?? process.cwd(), value.path);
  const bytes = new Uint8Array(await readFile(absolutePath));
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const blob = new Blob([bytes], { type: value.mimeType });
  const file = new File([bytes], value.name, { type: value.mimeType });
  return {
    value,
    absolutePath,
    bytes,
    arrayBuffer,
    blob,
    file,
    text: async () => await blob.text(),
    json: async () => {
      const parsed: unknown = JSON.parse(await blob.text());
      return parsed;
    },
  };
}
