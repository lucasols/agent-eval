import { z } from 'zod/v4';
import { displayBlockSchema } from './display.ts';

export const traceSpanKindSchema = z.enum([
  'eval', 'agent', 'llm', 'tool', 'retrieval', 'scorer', 'checkpoint', 'custom',
]);
export type TraceSpanKind = z.infer<typeof traceSpanKindSchema>;

export const traceSpanSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  caseId: z.string(),
  kind: traceSpanKindSchema,
  name: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum(['running', 'ok', 'error', 'cancelled']),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  display: z.array(displayBlockSchema).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  usage: z.object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  }).optional(),
  costUsd: z.number().nullable().optional(),
  cache: z.object({
    status: z.enum(['hit', 'miss', 'write', 'bypass']),
    key: z.string().optional(),
  }).optional(),
  error: z.object({
    name: z.string().optional(),
    message: z.string(),
    stack: z.string().optional(),
  }).optional(),
});
export type EvalTraceSpan = z.infer<typeof traceSpanSchema>;
