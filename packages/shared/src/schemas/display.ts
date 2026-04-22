import { z } from 'zod/v4';

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
});
/** Reference to a file that lives in the authored workspace. */
export type RepoFileRef = z.infer<typeof repoFileRefSchema>;

export const runArtifactRefSchema = z.object({
  source: z.literal('run'),
  artifactId: z.string(),
  mimeType: z.string(),
  fileName: z.string().optional(),
});
/** Reference to a generated artifact stored under a specific run. */
export type RunArtifactRef = z.infer<typeof runArtifactRefSchema>;

export const fileRefSchema = z.union([repoFileRefSchema, runArtifactRefSchema]);
/** File reference supported by media and file columns. */
export type FileRef = z.infer<typeof fileRefSchema>;

/** Schema for the supported column rendering kinds in list views. */
export const columnKindSchema = z.enum(['string', 'number', 'boolean']);
/** Display kind used by a column definition in the UI. */
export type ColumnKind = z.infer<typeof columnKindSchema>;

/** Schema for the built-in column formatting presets. */
export const columnFormatSchema = z.enum([
  'markdown',
  'json',
  'image',
  'audio',
  'video',
  'file',
  'usd',
  'duration',
  'percent',
  'number',
]);
/** Formatting preset applied to a column value in the UI. */
export type ColumnFormat = z.infer<typeof columnFormatSchema>;

/** Schema describing a rendered column in the eval results table. */
export const columnDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: columnKindSchema,
  format: columnFormatSchema.optional(),
  primary: z.boolean().optional(),
  isScore: z.boolean().optional(),
  passThreshold: z.number().optional(),
  defaultVisible: z.boolean().optional(),
  sortable: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
});
/** Column definition exposed to the UI for eval and case tables. */
export type ColumnDef = z.infer<typeof columnDefSchema>;

/** Schema for any supported value that can populate a table cell. */
export const cellValueSchema = z.union([jsonCellSchema, fileRefSchema]);
/** Value stored in a rendered eval result table cell. */
export type CellValue = z.infer<typeof cellValueSchema>;
