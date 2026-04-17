import { z } from 'zod/v4';

export const traceSpanKindSchema = z.enum([
  'eval', 'agent', 'llm', 'tool', 'retrieval', 'scorer', 'checkpoint', 'custom',
]);
export type TraceSpanKind = z.infer<typeof traceSpanKindSchema>;

export const traceAttributeDisplayFormatSchema = z.enum([
  'string',
  'number',
  'usd',
  'duration',
  'json',
]);
export type TraceAttributeDisplayFormat = z.infer<
  typeof traceAttributeDisplayFormatSchema
>;

export const traceAttributeDisplayPlacementSchema = z.enum([
  'tree',
  'detail',
  'section',
]);
export type TraceAttributeDisplayPlacement = z.infer<
  typeof traceAttributeDisplayPlacementSchema
>;

export const traceAttributeDisplaySchema = z.object({
  key: z.string().optional(),
  path: z.string(),
  label: z.string().optional(),
  format: traceAttributeDisplayFormatSchema.optional(),
  placements: z.array(traceAttributeDisplayPlacementSchema).optional(),
  scope: z.enum(['self', 'subtree']).optional(),
  mode: z.enum(['all', 'last', 'sum']).optional(),
});
export type TraceAttributeDisplay = z.infer<typeof traceAttributeDisplaySchema>;

export const traceDisplayConfigSchema = z.object({
  attributes: z.array(traceAttributeDisplaySchema).optional(),
});
export type TraceDisplayConfig = z.infer<typeof traceDisplayConfigSchema>;

export type TraceAttributeTransformContext = {
  value: unknown;
  span: EvalTraceSpan;
};

export type TraceAttributeTransform = (
  ctx: TraceAttributeTransformContext,
) => unknown;

export const traceAttributeDisplayInputSchema = z.object({
  key: z.string().optional(),
  path: z.string(),
  label: z.string().optional(),
  format: traceAttributeDisplayFormatSchema.optional(),
  placements: z.array(traceAttributeDisplayPlacementSchema).optional(),
  scope: z.enum(['self', 'subtree']).optional(),
  mode: z.enum(['all', 'last', 'sum']).optional(),
  transform: z.custom<TraceAttributeTransform>(
    (value) => value === undefined || typeof value === 'function',
    { message: 'Expected a transform function' },
  ).optional(),
});
export type TraceAttributeDisplayInput = z.infer<
  typeof traceAttributeDisplayInputSchema
>;

export const traceDisplayInputConfigSchema = z.object({
  attributes: z.array(traceAttributeDisplayInputSchema).optional(),
});
export type TraceDisplayInputConfig = z.infer<typeof traceDisplayInputConfigSchema>;

export const traceSpanSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  caseId: z.string(),
  kind: traceSpanKindSchema,
  name: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum(['running', 'ok', 'error', 'cancelled']),
  attributes: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    name: z.string().optional(),
    message: z.string(),
    stack: z.string().optional(),
  }).optional(),
});
export type EvalTraceSpan = z.infer<typeof traceSpanSchema>;
