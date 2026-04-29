import {
  defineEval,
  evalAssert,
  isInEvalScope,
  setEvalOutput,
} from '@ls-stack/agent-eval';
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
  columns: { response: { label: 'Response', format: 'markdown' } },
  stats: [
    { kind: 'cases' },
    { kind: 'passRate', accent: true },
    {
      kind: 'column',
      key: 'matchesGoldAnswer',
      aggregate: 'avg',
      format: 'percent',
    },
    { kind: 'duration' },
  ],
  execute: ({ input }) => {
    setEvalOutput('response', `Borderline result for: ${input.prompt}`);
  },
  scores: {
    matchesGoldAnswer: {
      label: 'Matches Gold Answer',
      passThreshold: 1,
      compute: ({ outputs }) =>
        getResponseText(outputs.response).includes('Approved refund') ? 1 : 0,
    },
  },
  charts: [
    {
      type: 'bar',
      metrics: [
        {
          source: 'column',
          key: 'matchesGoldAnswer',
          aggregate: 'passThresholdRate',
          color: 'success',
        },
      ],
      yDomain: { left: { min: 0, max: 1 } },
    },
  ],
});

defineEval<{ ticketId: string }>({
  id: 'assertion-failure-demo',
  title: 'Assertion Failure Demo',
  cases: [
    { id: 'assertion-failure-visible-output', input: { ticketId: 'T-441' } },
  ],
  columns: { response: { label: 'Response', format: 'markdown' } },
  execute: ({ input }) => {
    setEvalOutput(
      'response',
      `Missing audit note for ticket ${input.ticketId}.`,
    );
    evalAssert(
      false,
      'operator note must be attached before closing the ticket',
    );
  },
});

defineEval({
  id: 'silent-pass-demo',
  execute: () => {
    evalAssert(
      isInEvalScope() === 'eval',
      'silent pass demo should run inside eval execution',
    );
  },
});

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
