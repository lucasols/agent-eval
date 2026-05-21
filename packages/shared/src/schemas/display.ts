import { z } from 'zod';

export const scalarCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
/** Primitive table cell value supported by the eval UI. */
export type ScalarCell = z.infer<typeof scalarCellSchema>;

export const jsonCellSchema: z.ZodType<
  string | number | boolean | null | Record<string, unknown> | unknown[]
> = z.lazy(() =>
  z.union([
    scalarCellSchema,
    z.array(jsonCellSchema),
    z.record(z.string(), jsonCellSchema),
  ]),
);
/** JSON-safe value supported by `format: 'json'` columns. */
export type JsonCell = z.infer<typeof jsonCellSchema>;

export const repoFileRefSchema = z.object({
  source: z.literal('repo'),
  path: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
/** Reference to a file that lives in the authored workspace. */
export type RepoFileRef = z.infer<typeof repoFileRefSchema>;

export const runArtifactRefSchema = z.object({
  source: z.literal('run'),
  artifactId: z.string(),
  mimeType: z.string(),
  fileName: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
/** Reference to a generated artifact stored under a specific run. */
export type RunArtifactRef = z.infer<typeof runArtifactRefSchema>;

export const fileRefSchema = z.union([repoFileRefSchema, runArtifactRefSchema]);
/** File reference supported by media and file columns. */
export type FileRef = z.infer<typeof fileRefSchema>;

/** Numeric presentation options for values rendered with `format: 'number'`. */
export type NumberDisplayOptions = {
  /** Number notation used when rendering the value. */
  notation?: 'standard' | 'compact';
  /** Compact style used when `notation: 'compact'` is enabled. */
  compactDisplay?: 'short' | 'long';
  /** String prepended to the rendered number, such as `$`. */
  prefix?: string;
  /** String appended to the rendered number, such as ` ms`. */
  suffix?: string;
  /** Minimum number of decimal places to render. */
  minDecimalPlaces?: number;
  /** Maximum number of decimal places to render. */
  maxDecimalPlaces?: number;
};

const rawNumberDisplayOptionsSchema = z.object({
  notation: z.enum(['standard', 'compact']).optional(),
  compactDisplay: z.enum(['short', 'long']).optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  minDecimalPlaces: z.number().int().min(0).optional(),
  maxDecimalPlaces: z.number().int().min(0).optional(),
});

/** Schema for numeric presentation options used by number-formatted values. */
export const numberDisplayOptionsSchema: z.ZodType<NumberDisplayOptions> =
  rawNumberDisplayOptionsSchema.refine(
    (options) => {
      if (options.minDecimalPlaces === undefined) return true;
      if (options.maxDecimalPlaces === undefined) return true;
      return options.minDecimalPlaces <= options.maxDecimalPlaces;
    },
    {
      message:
        'minDecimalPlaces must be less than or equal to maxDecimalPlaces',
      path: ['minDecimalPlaces'],
    },
  );

/** Schema for the supported column rendering kinds in list views. */
export const columnKindSchema = z.enum(['string', 'number', 'boolean']);
/** Display kind used by a column definition in the UI. */
export type ColumnKind = z.infer<typeof columnKindSchema>;

/** Schema for the built-in column formatting presets. */
export const columnFormatSchema = z.enum([
  'boolean',
  'markdown',
  'json',
  'image',
  'html',
  'pdf',
  'audio',
  'video',
  'file',
  'duration',
  'percent',
  'number',
  'passFail',
  'stars',
]);
/** Formatting preset applied to a column value in the UI. */
export type ColumnFormat = z.infer<typeof columnFormatSchema>;

/** Schema describing a rendered column in the eval results table. */
export const columnDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: columnKindSchema,
  format: columnFormatSchema.optional(),
  numberFormat: numberDisplayOptionsSchema.optional(),
  isScore: z.boolean().optional(),
  isManualScore: z.boolean().optional(),
  passThreshold: z.number().optional(),
  maxStars: z.number().int().min(2).optional(),
  hideInTable: z.boolean().optional(),
  hideIfNoValue: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
});
/** Column definition exposed to the UI for eval and case tables. */
export type ColumnDef = z.infer<typeof columnDefSchema>;

/** Schema for any supported value that can populate a table cell. */
export const cellValueSchema = z.union([jsonCellSchema, fileRefSchema]);
/** Value stored in a rendered eval result table cell. */
export type CellValue = z.infer<typeof cellValueSchema>;
