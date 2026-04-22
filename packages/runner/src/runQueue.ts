import type {
  CaseDetail,
  CaseRow,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';

export type QueuedCaseExecution = {
  caseDetail: CaseDetail;
  caseRow: CaseRow;
};

export type QueuedCaseRun = {
  execute: (params: {
    startTime: number;
    signal: AbortSignal;
    globalTraceDisplay: TraceDisplayInputConfig | undefined;
  }) => Promise<QueuedCaseExecution>;
  onComplete: (result: QueuedCaseExecution) => Promise<void> | void;
};

type RunQueueState = {
  abortController: AbortController;
};

export async function executeQueuedCases(params: {
  runState: RunQueueState;
  queuedCases: QueuedCaseRun[];
  concurrency: number;
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
}): Promise<void> {
  const {
    runState,
    queuedCases,
    concurrency,
    globalTraceDisplay,
  } = params;

  let nextCaseIndex = 0;
  let workerError: unknown = undefined;
  const workerCount = Math.min(concurrency, queuedCases.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (
      !runState.abortController.signal.aborted &&
      workerError === undefined
    ) {
      const queuedCase = queuedCases[nextCaseIndex];
      nextCaseIndex += 1;

      if (queuedCase === undefined) {
        return;
      }

      try {
        await executeQueuedCase({
          queuedCase,
          runState,
          globalTraceDisplay,
        });
      } catch (error) {
        workerError =
          error instanceof Error ? error : new Error(String(error));
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
  runState: RunQueueState;
  globalTraceDisplay: TraceDisplayInputConfig | undefined;
}): Promise<void> {
  const { queuedCase, runState, globalTraceDisplay } = params;

  const startTime = Date.now();
  const result = await queuedCase.execute({
    globalTraceDisplay,
    signal: runState.abortController.signal,
    startTime,
  });
  await queuedCase.onComplete(result);
}
