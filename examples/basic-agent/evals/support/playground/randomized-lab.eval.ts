import {
  defineEval,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';

function samplePercent(): number {
  return Math.round(Math.random() * 100) / 100;
}

function sampleScore(): number {
  return Math.round(Math.random() * 100) / 100;
}

function sampleDelayMs(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function waitForDelay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

defineEval<{ prompt: string }>({
  id: 'randomized-lab',
  cases: [
    {
      id: 'random-sanity-check',
      input: { prompt: 'Generate a random experiment result for the UI.' },
    },
  ],
  columns: {
    response: { label: 'Response', format: 'markdown' },
    randomValue: { label: 'Random Value', format: 'percent' },
  },
  execute: async ({ input }) => {
    await evalTracer.span(
      { kind: 'agent', name: 'randomized-lab' },
      async () => {
        evalSpan.setAttribute('input', input);

        const randomValue = samplePercent();
        const analysisDelayMs = sampleDelayMs(180, 340);

        await evalTracer.span(
          { kind: 'llm', name: 'roll-random-signal' },
          async () => {
            await waitForDelay(analysisDelayMs);

            evalSpan.setAttributes({
              input: { prompt: input.prompt },
              output: { analysisDelayMs, randomValue },
            });
          },
        );

        const publishDelayMs = sampleDelayMs(140, 280);
        const responseText = `Randomized result for: ${input.prompt}`;

        await evalTracer.span(
          { kind: 'tool', name: 'publish-randomized-result' },
          async () => {
            await waitForDelay(publishDelayMs);

            evalSpan.setAttributes({
              input: { randomValue },
              output: { publishDelayMs, responseText },
            });
          },
        );

        setEvalOutput('response', responseText);
        setEvalOutput('randomValue', randomValue);

        evalSpan.setAttribute('output', {
          publishDelayMs,
          randomValue,
          responseText,
        });
      },
    );
  },
  scores: {
    randomScore: { label: 'Random Score', compute: () => sampleScore() },
  },
  charts: [
    {
      heading: 'Scores',
      type: 'line',
      metrics: [
        { source: 'builtin', metric: 'passRate', color: 'accent' },
        {
          source: 'column',
          key: 'randomScore',
          aggregate: 'avg',
          color: 'accentDim',
        },
        {
          source: 'column',
          key: 'randomValue',
          aggregate: 'avg',
          color: 'warning',
          axis: 'right',
        },
      ],
      yDomain: { left: { min: 0, max: 1 }, right: { min: 0, max: 1 } },
    },
    {
      heading: 'Cost per run',
      type: 'area',
      metrics: [{ source: 'builtin', metric: 'cost', color: 'cost' }],
    },
  ],
});
