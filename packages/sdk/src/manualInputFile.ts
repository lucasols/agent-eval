import { z } from 'zod/v4';
import type { ManualInputFileValue } from './types.ts';

/**
 * Zod schema describing one file uploaded through the manual-input modal.
 *
 * Use this as the field type on your `manualInput.schema` whenever you mark
 * a field with `{ asFile: true }` in `manualInput.fields`. The browser
 * captures the picked / dropped / pasted file, encodes it as a base64
 * `data:` URL, and the server validates the wire payload against this
 * schema before flowing it into the case input.
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
  size: z.number().int().nonnegative(),
  dataUrl: z.string().startsWith('data:'),
}) satisfies z.ZodType<ManualInputFileValue>;
