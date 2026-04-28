import type {
  CaseDetail,
  CaseRow,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';

export type QueuedCaseExecution = { caseDetail: CaseDetail; caseRow: CaseRow };

export type QueuedCaseRun = {
  execute: (params: {
    startTime: number;
    globalTraceDisplay: TraceDisplayInputConfig | undefined;
  }) => Promise<QueuedCaseExecution>;
  onComplete: (result: QueuedCaseExecution) => Promise<void> | void;
};

export async function executeQueuedCases(params: {
  queuedCases: QueuedCaseRun[];
  concurrency: number;
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
}): Promise<void> {
  const { queuedCases, concurrency, globalTraceDisplay } = params;

  let nextCaseIndex = 0;
  let workerError: unknown = undefined;
  const workerCount = Math.min(concurrency, queuedCases.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (workerError === undefined) {
      const queuedCase = queuedCases[nextCaseIndex];
      nextCaseIndex += 1;

      if (queuedCase === undefined) {
        return;
      }

      try {
        await executeQueuedCase({ queuedCase, globalTraceDisplay });
      } catch (error) {
        workerError = error instanceof Error ? error : new Error(String(error));
        return;
      }
    }
  });

  await Promise.all(workers);

  if (workerError instanceof Error) {
    throw workerError;
  }
  if (workerError !== undefined) {
    const workerErrorMessage =
      typeof workerError === 'string'
        ? workerError
        : typeof workerError === 'number' ||
            typeof workerError === 'boolean' ||
            typeof workerError === 'bigint'
          ? String(workerError)
          : workerError === null
            ? 'null'
            : 'Unknown queue worker error';
    throw new Error(workerErrorMessage);
  }
}

async function executeQueuedCase(params: {
  queuedCase: QueuedCaseRun;
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
}): Promise<void> {
  const { queuedCase, globalTraceDisplay } = params;

  const startTime = Date.now();
  const result = await queuedCase.execute({ globalTraceDisplay, startTime });
  await queuedCase.onComplete(result);
}
