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

export const columnDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['string', 'number', 'boolean']),
  defaultVisible: z.boolean().optional(),
  sortable: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
});
export type ColumnDef = z.infer<typeof columnDefSchema>;
