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
/** Server-sent event name emitted by the runner or backend. */
export type SseEventType = z.infer<typeof sseEventTypeSchema>;

/** Schema for the SSE envelope used to stream run updates to clients. */
export const sseEnvelopeSchema = z.object({
  type: z.string(),
  runId: z.string().optional(),
  timestamp: z.string(),
  payload: z.unknown(),
});
/** Wire format for a streamed event emitted during eval execution. */
export type SseEnvelope = z.infer<typeof sseEnvelopeSchema>;
