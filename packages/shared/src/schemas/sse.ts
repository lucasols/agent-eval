import { z } from 'zod/v4';

export const sseEventTypeSchema = z.enum([
  'discovery.updated',
  'run.started',
  'run.summary',
  'case.started',
  'case.updated',
  'case.finished',
  'trace.span',
  'run.finished',
  'run.cancelled',
  'run.error',
]);
export type SseEventType = z.infer<typeof sseEventTypeSchema>;

export const sseEnvelopeSchema = z.object({
  type: z.string(),
  runId: z.string().optional(),
  timestamp: z.string(),
  payload: z.unknown(),
});
export type SseEnvelope = z.infer<typeof sseEnvelopeSchema>;
