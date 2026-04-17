import { z } from 'zod/v4';

export const traceSpanKindSchema = z.enum([
  'eval', 'agent', 'llm', 'tool', 'retrieval', 'scorer', 'checkpoint', 'custom',
]);
/** Semantic category used to classify a trace span in the UI. */
export type TraceSpanKind = z.infer<typeof traceSpanKindSchema>;

export const traceAttributeDisplayFormatSchema = z.enum([
  'string',
  'number',
  'usd',
  'duration',
  'json',
]);
/**
 * Formatting hint for trace attribute values rendered by the UI.
 *
 * This affects presentation only and does not change the stored value.
 */
export type TraceAttributeDisplayFormat = z.infer<
  typeof traceAttributeDisplayFormatSchema
>;

export const traceAttributeDisplayPlacementSchema = z.enum([
  'tree',
  'detail',
  'section',
]);
/** UI locations where a trace attribute may be rendered. */
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
/**
 * Resolved trace display rule consumed by the UI.
 *
 * `path` points at the attribute to render on each span. `scope` and `mode`
 * control whether the value comes from the current span only or from the full
 * subtree, and how multiple matches are combined.
 */
export type TraceAttributeDisplay = z.infer<typeof traceAttributeDisplaySchema>;

export const traceDisplayConfigSchema = z.object({
  attributes: z.array(traceAttributeDisplaySchema).optional(),
});
/** UI-ready trace display configuration attached to case details. */
export type TraceDisplayConfig = z.infer<typeof traceDisplayConfigSchema>;

/** Context passed to a `traceDisplay` transform while resolving a span value. */
export type TraceAttributeTransformContext = {
  value: unknown;
  span: EvalTraceSpan;
};

/**
 * Runner-side transform used to derive a display value from a raw trace
 * attribute.
 */
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
/**
 * Authored trace display rule accepted in eval definitions and config files.
 *
 * `key` allows the same source `path` to be displayed multiple ways, such as
 * USD and BRL views of a single `costUsd` attribute. `transform` runs in the
 * runner before the UI receives the resolved trace payload.
 */
export type TraceAttributeDisplayInput = z.infer<
  typeof traceAttributeDisplayInputSchema
>;

export const traceDisplayInputConfigSchema = z.object({
  attributes: z.array(traceAttributeDisplayInputSchema).optional(),
});
/** Trace display configuration authored by users in config or eval files. */
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
/** Persisted trace span shape stored for each eval case run. */
export type EvalTraceSpan = z.infer<typeof traceSpanSchema>;
