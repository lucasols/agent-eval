import { blocks, defineEval, evalAssert, setOutput } from '@agent-evals/sdk';
import { getResponseText } from '../../../src/evals/exampleEvalUtils.ts';

defineEval<{ prompt: string }>({
  id: 'score-threshold-demo',
  title: 'Score Threshold Demo',
  cases: [
    {
      id: 'score-threshold-miss',
      input: { prompt: 'Review the refund summary against the gold answer.' },
    },
  ],
  columns: { response: { label: 'Response', primary: true } },
  execute: ({ input }) => {
    setOutput('response', [
      blocks.markdown(`Borderline result for: ${input.prompt}`),
    ]);
  },
  scores: {
    matchesGoldAnswer: {
      label: 'Matches Gold Answer',
      passThreshold: 1,
      compute: ({ outputs }) =>
        getResponseText(outputs.response).includes('Approved refund') ? 1 : 0,
    },
  },
  passThreshold: 0.5,
});

defineEval<{ ticketId: string }>({
  id: 'assertion-failure-demo',
  title: 'Assertion Failure Demo',
  cases: [
    { id: 'assertion-failure-visible-output', input: { ticketId: 'T-441' } },
  ],
  columns: { response: { label: 'Response', primary: true } },
  execute: ({ input }) => {
    setOutput('response', [
      blocks.markdown(`Missing audit note for ticket ${input.ticketId}.`),
    ]);
    evalAssert(
      false,
      'operator note must be attached before closing the ticket',
    );
  },
});

defineEval({ id: 'silent-pass-demo', execute: () => {} });

defineEval<{ queue: string }>({
  id: 'silent-assertion-demo',
  title: 'Silent Assertion Demo',
  cases: [
    { id: 'silent-assertion-no-output', input: { queue: 'manual-review' } },
  ],
  execute: () => {
    evalAssert(false, 'manual review queue must leave a handoff note');
  },
});
