import { z } from 'zod/v4';

export const scalarCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ScalarCell = z.infer<typeof scalarCellSchema>;

export const repoFileRefSchema = z.object({
  source: z.literal('repo'),
  path: z.string(),
  mimeType: z.string().optional(),
});
export type RepoFileRef = z.infer<typeof repoFileRefSchema>;

export const runArtifactRefSchema = z.object({
  source: z.literal('run'),
  artifactId: z.string(),
  mimeType: z.string(),
  fileName: z.string().optional(),
});
export type RunArtifactRef = z.infer<typeof runArtifactRefSchema>;

export const fileRefSchema = z.union([repoFileRefSchema, runArtifactRefSchema]);
export type FileRef = z.infer<typeof fileRefSchema>;

export const displayBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), label: z.string().optional(), text: z.string() }),
  z.object({ kind: z.literal('markdown'), label: z.string().optional(), text: z.string() }),
  z.object({ kind: z.literal('json'), label: z.string().optional(), value: z.unknown() }),
  z.object({ kind: z.literal('image'), label: z.string().optional(), ref: fileRefSchema, alt: z.string().optional() }),
  z.object({ kind: z.literal('audio'), label: z.string().optional(), ref: fileRefSchema, title: z.string().optional() }),
  z.object({ kind: z.literal('video'), label: z.string().optional(), ref: fileRefSchema, title: z.string().optional() }),
  z.object({ kind: z.literal('file'), label: z.string().optional(), ref: fileRefSchema, title: z.string().optional() }),
]);
export type DisplayBlock = z.infer<typeof displayBlockSchema>;

export const columnKindSchema = z.enum(['string', 'number', 'boolean', 'blocks']);
export type ColumnKind = z.infer<typeof columnKindSchema>;

export const columnFormatSchema = z.enum(['usd', 'duration', 'percent', 'number']);
export type ColumnFormat = z.infer<typeof columnFormatSchema>;

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
export type ColumnDef = z.infer<typeof columnDefSchema>;

export const cellValueSchema = z.union([scalarCellSchema, z.array(displayBlockSchema)]);
export type CellValue = z.infer<typeof cellValueSchema>;
