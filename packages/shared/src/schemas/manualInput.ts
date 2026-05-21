import { z } from 'zod';

/**
 * Common metadata shared by every manual-input field descriptor exposed to
 * the web UI. The runner builds these from the eval's authored Zod schema and
 * any per-field overrides, so the client never needs the schema itself.
 */
const manualInputFieldBaseSchema = z.object({
  /** Top-level key on the eval input object that this field writes to. */
  key: z.string(),
  /** Human-readable label rendered next to the field in the modal. */
  label: z.string(),
  /** Optional helper text rendered under the label. */
  description: z.string().optional(),
  /** Optional placeholder rendered inside the input element. */
  placeholder: z.string().optional(),
  /** Whether the field must be filled before the run can be submitted. */
  required: z.boolean(),
  /**
   * Default value used to prefill the field. Type matches the underlying
   * widget kind (`string` for text/multiline/select, `number` for number,
   * `boolean` for boolean, JSON-serialisable for `json`).
   */
  defaultValue: z.unknown().optional(),
});

/** One option rendered by the `select` widget. */
export const manualInputSelectOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
/** One option rendered by the `select` widget. */
export type ManualInputSelectOption = z.infer<
  typeof manualInputSelectOptionSchema
>;

/** Single line text widget descriptor. */
export const manualInputTextFieldSchema = manualInputFieldBaseSchema.extend({
  kind: z.literal('text'),
  /** Optional minimum character length enforced client-side. */
  minLength: z.number().int().min(0).optional(),
  /** Optional maximum character length enforced client-side. */
  maxLength: z.number().int().min(0).optional(),
});

/** Multi-line textarea widget descriptor. */
export const manualInputMultilineFieldSchema =
  manualInputFieldBaseSchema.extend({
    kind: z.literal('multiline'),
    /** Optional minimum character length enforced client-side. */
    minLength: z.number().int().min(0).optional(),
    /** Optional maximum character length enforced client-side. */
    maxLength: z.number().int().min(0).optional(),
    /** Suggested number of visible textarea rows; UI may clamp this. */
    rows: z.number().int().min(1).optional(),
  });

/** Numeric input widget descriptor. */
export const manualInputNumberFieldSchema = manualInputFieldBaseSchema.extend({
  kind: z.literal('number'),
  /** Optional inclusive lower bound. */
  min: z.number().optional(),
  /** Optional inclusive upper bound. */
  max: z.number().optional(),
  /** Optional UI step increment. */
  step: z.number().positive().optional(),
  /** Whether the value must be an integer. */
  integer: z.boolean().optional(),
});

/** Boolean checkbox/toggle widget descriptor. */
export const manualInputBooleanFieldSchema = manualInputFieldBaseSchema.extend({
  kind: z.literal('boolean'),
});

/** Single-select dropdown widget descriptor. */
export const manualInputSelectFieldSchema = manualInputFieldBaseSchema.extend({
  kind: z.literal('select'),
  options: z.array(manualInputSelectOptionSchema),
});

/** JSON textarea widget descriptor used for nested objects, arrays, and unions. */
export const manualInputJsonFieldSchema = manualInputFieldBaseSchema.extend({
  kind: z.literal('json'),
  /** Suggested number of visible textarea rows; UI may clamp this. */
  rows: z.number().int().min(1).optional(),
});

/**
 * File / image upload widget descriptor. The widget supports clicking to
 * pick a file, drag-and-drop onto the dropzone, and pasting an image from
 * the system clipboard. The submitted value references a staged file artifact.
 */
export const manualInputFileFieldSchema = manualInputFieldBaseSchema.extend({
  kind: z.literal('file'),
  /**
   * Browser `accept` attribute (e.g. `image/*`, `image/png,image/jpeg`,
   * `.pdf`). When omitted the picker accepts any file type.
   */
  accept: z.string().optional(),
  /** Optional client-side maximum file size in bytes. */
  maxSizeBytes: z.number().int().positive().optional(),
});

/**
 * Discriminated union of all supported manual-input widget kinds. The web UI
 * dispatches to the matching field component based on `kind`.
 */
export const manualInputFieldDescriptorSchema = z.discriminatedUnion('kind', [
  manualInputTextFieldSchema,
  manualInputMultilineFieldSchema,
  manualInputNumberFieldSchema,
  manualInputBooleanFieldSchema,
  manualInputSelectFieldSchema,
  manualInputJsonFieldSchema,
  manualInputFileFieldSchema,
]);
/** Single field descriptor rendered by the manual-input modal. */
export type ManualInputFieldDescriptor = z.infer<
  typeof manualInputFieldDescriptorSchema
>;
/** Widget kind discriminant for {@link ManualInputFieldDescriptor}. */
export type ManualInputFieldKind = ManualInputFieldDescriptor['kind'];

/**
 * Wire-format descriptor attached to an `EvalSummary` when the eval declares
 * `manualInput`. Carries the ordered list of fields the modal renders and
 * basic context shown in the modal header.
 */
export const manualInputDescriptorSchema = z.object({
  /** Optional title shown in the modal header. Defaults to the eval title. */
  title: z.string().optional(),
  /** Optional helper text shown above the form. */
  description: z.string().optional(),
  /** Optional submit button label. Defaults to `Run`. */
  submitLabel: z.string().optional(),
  /** Ordered list of fields rendered in the modal. */
  fields: z.array(manualInputFieldDescriptorSchema),
});
/** Wire-format manual-input descriptor attached to an `EvalSummary`. */
export type ManualInputDescriptor = z.infer<typeof manualInputDescriptorSchema>;
