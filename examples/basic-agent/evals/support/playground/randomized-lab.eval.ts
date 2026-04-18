import { blocks, defineEval, setOutput, span, tracer } from '@agent-evals/sdk';

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
  title: 'Randomized Lab',
  description: 'Manual playground eval with random outputs and random scores',
  cases: [
    {
      id: 'random-sanity-check',
      input: {
        prompt: 'Generate a random experiment result for the UI.',
      },
    },
  ],
  columns: {
    response: { label: 'Response', primary: true },
    randomValue: { label: 'Random Value', format: 'percent' },
  },
  execute: async ({ input }) => {
    await tracer.span({ kind: 'agent', name: 'randomized-lab' }, async () => {
      span.setAttribute('input', input);

      const randomValue = samplePercent();
      const analysisDelayMs = sampleDelayMs(180, 340);

      await tracer.span({ kind: 'llm', name: 'roll-random-signal' }, async () => {
        await waitForDelay(analysisDelayMs);

        span.setAttributes({
          input: { prompt: input.prompt },
          output: {
            analysisDelayMs,
            randomValue,
          },
        });
      });

      const publishDelayMs = sampleDelayMs(140, 280);
      const responseText = `Randomized result for: ${input.prompt}`;

      await tracer.span(
        { kind: 'tool', name: 'publish-randomized-result' },
        async () => {
          await waitForDelay(publishDelayMs);

          span.setAttributes({
            input: { randomValue },
            output: {
              publishDelayMs,
              responseText,
            },
          });
        },
      );

      setOutput('response', [blocks.markdown(responseText)]);
      setOutput('randomValue', randomValue);

      span.setAttribute('output', {
        publishDelayMs,
        randomValue,
        responseText,
      });
    });
  },
  scores: {
    randomScore: {
      label: 'Random Score',
      compute: () => sampleScore(),
    },
  },
});
