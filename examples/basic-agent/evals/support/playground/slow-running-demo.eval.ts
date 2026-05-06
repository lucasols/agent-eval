import {
  defineEval,
  evalSpan,
  evalTracer,
  setEvalOutput,
} from '@ls-stack/agent-eval';

const slowSteps = [
  { name: 'prepare-long-running-context', delayMs: 2200 },
  { name: 'simulate-model-deliberation', delayMs: 2600 },
  { name: 'publish-slow-result', delayMs: 2400 },
] as const;

async function waitForDelay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

defineEval<{ prompt: string }>({
  id: 'slow-running-demo',
  title: 'Slow Running Demo',
  cache: { read: false, store: false },
  cases: [
    {
      id: 'elapsed-status-preview',
      input: {
        prompt: 'Keep the eval running long enough to inspect live UI status.',
      },
    },
  ],
  columns: {
    response: { label: 'Response', format: 'markdown' },
    observedDurationMs: { label: 'Observed Duration', format: 'duration' },
    stepCount: { label: 'Steps', format: 'number' },
  },
  execute: async ({ input }) => {
    const startedAtMs = Date.now();

    await evalTracer.span(
      { kind: 'agent', name: 'slow-running-demo' },
      async () => {
        evalSpan.setAttribute('input', input);

        for (const step of slowSteps) {
          await evalTracer.span({ kind: 'tool', name: step.name }, async () => {
            await waitForDelay(step.delayMs);
            evalSpan.setAttributes({
              input: { prompt: input.prompt },
              output: { delayMs: step.delayMs },
            });
          });
        }

        const observedDurationMs = Date.now() - startedAtMs;
        const response =
          `Completed slow demo for: ${input.prompt}\n\n` +
          `Elapsed wall time: ${String(observedDurationMs)}ms`;

        setEvalOutput('response', response);
        setEvalOutput('observedDurationMs', observedDurationMs);
        setEvalOutput('stepCount', slowSteps.length);

        evalSpan.setAttribute('output', {
          observedDurationMs,
          stepCount: slowSteps.length,
        });
      },
    );
  },
  scores: {
    completedSlowRun: {
      label: 'Completed Slow Run',
      passThreshold: 1,
      compute: ({ outputs }) =>
        typeof outputs.observedDurationMs === 'number' &&
        outputs.observedDurationMs >= 7000
          ? 1
          : 0,
    },
  },
});
