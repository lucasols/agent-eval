import type {
  CaseDetail,
  CaseRow,
  CreateRunRequest,
  RunManifest,
  RunSummary,
  SseEnvelope,
} from '@agent-evals/shared';
import type { EvalMeta } from './runOrchestration.ts';

export type RunChildContext = {
  request: CreateRunRequest;
  workspaceRoot: string;
  runDir: string;
  manifest: RunManifest;
  summary: RunSummary;
  evals: EvalMeta[];
};

export type RunChildMessage =
  | { type: 'event'; event: SseEnvelope }
  | { type: 'case.finished'; caseDetail: CaseDetail; caseRow: CaseRow }
  | { type: 'done'; evals: EvalMeta[] };

export function isRunChildMessage(value: unknown): value is RunChildMessage {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || typeof value.type !== 'string') return false;

  if (value.type === 'event') return 'event' in value;
  if (value.type === 'case.finished') {
    return 'caseDetail' in value && 'caseRow' in value;
  }
  return value.type === 'done' && 'evals' in value;
}
