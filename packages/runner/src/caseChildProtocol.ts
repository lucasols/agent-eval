import type {
  CacheMode,
  CaseDetail,
  CaseRow,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';
import type { PendingCacheWrite } from './cacheStore.ts';

export type CaseChildContext = {
  evalId: string;
  evalKey: string;
  evalFilePath: string;
  evalFileRelativePath: string;
  sourceFingerprint: string | undefined;
  evalCase: { id: string; input: unknown; tags?: string[] };
  trial: number;
  startTime: number;
  cacheMode: CacheMode;
  cacheEnabled: boolean;
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
  workspaceRoot: string;
  artifactDir: string;
  runId: string;
};

export type CaseChildResult = {
  caseDetail: CaseDetail;
  caseRow: CaseRow;
  pendingCacheWrites: PendingCacheWrite[];
};

export type CaseChildParentMessage = {
  type: 'start';
  context: CaseChildContext;
};

export type CaseChildMessage =
  | { type: 'done'; result: CaseChildResult }
  | { type: 'error'; message: string };

export function isCaseChildParentMessage(
  value: unknown,
): value is CaseChildParentMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'start' &&
    'context' in value
  );
}

export function isCaseChildMessage(value: unknown): value is CaseChildMessage {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || typeof value.type !== 'string') return false;
  if (value.type === 'done') return 'result' in value;
  return value.type === 'error' && 'message' in value;
}
