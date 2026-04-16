import {
  defineEval,
  blocks,
  estimateCost,
  createPriceRegistry,
  type EvalCase,
} from '@agent-evals/sdk';
import { runRefundAgent, type RefundRequest } from '../src/refundAgent.ts';

const REFUND_REGEX = /refund/i;

const pricing = createPriceRegistry({
  'gpt-4o': {
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10,
  },
});

const refundCases: EvalCase<RefundRequest>[] = [
  {
    id: 'simple-text',
    input: {
      message: 'I want a refund for order #123',
      locale: 'en-US',
    },
    displayInput: [
      blocks.markdown('**Request:** I want a refund for order #123'),
    ],
    columns: {
      locale: 'en-US',
      priority: 'normal',
    },
  },
  {
    id: 'with-image',
    input: {
      message: 'Please refund this damaged item',
      receiptImage: 'evals/datasets/assets/receipt-1.png',
    },
    displayInput: [
      blocks.markdown('**Request:** Please refund this damaged item'),
      blocks.text('(Receipt image attached)'),
    ],
    columns: {
      locale: 'en-US',
      priority: 'high',
    },
  },
  {
    id: 'with-audio',
    input: {
      message: 'I need to return this product',
      voiceNote: 'evals/datasets/assets/note-1.mp3',
    },
    displayInput: [
      blocks.markdown('**Request:** I need to return this product'),
      blocks.text('(Voice note attached)'),
    ],
    columns: {
      locale: 'en-US',
      priority: 'normal',
    },
  },
];

defineEval({
  id: 'refund-agent',
  title: 'Refund Agent',
  description: 'Tests the refund agent with various input types',
  data: refundCases,
  columnDefs: [
    { key: 'locale', label: 'Locale', kind: 'string', defaultVisible: true },
    { key: 'priority', label: 'Priority', kind: 'string', defaultVisible: true },
    { key: 'toolCalls', label: 'Tool Calls', kind: 'number', defaultVisible: true },
  ],
  task: async ({ input, trace }) => {
    const result = await trace.span(
      { kind: 'agent', name: 'refund-agent' },
      async (span) => {
        span.setInput(input);

        await trace.span(
          { kind: 'llm', name: 'plan-refund' },
          (llmSpan) => {
            llmSpan.setInput({ prompt: input.message });
            llmSpan.setUsage({ inputTokens: 150, outputTokens: 50 });
            const cost = estimateCost(
              'gpt-4o',
              { inputTokens: 150, outputTokens: 50 },
              pricing,
            );
            llmSpan.setCostUsd(cost);
            llmSpan.setOutput({ plan: 'approve refund' });
            return { plan: 'approve refund' };
          },
        );

        const agentResult = await trace.span(
          { kind: 'tool', name: 'process-refund' },
          (toolSpan) => {
            toolSpan.setInput({ action: 'refund', request: input });
            const output = runRefundAgent(input);
            toolSpan.setOutput(output);
            return output;
          },
        );

        span.setOutput(agentResult);
        return agentResult;
      },
    );

    trace.checkpoint('final-state', {
      approved: true,
      confidence: 0.95,
    });

    return {
      output: result.finalText,
      displayOutput: [blocks.markdown(result.finalText)],
      columns: {
        toolCalls: result.toolCalls,
      },
    };
  },
  scorers: [
    ({ output }) => ({
      id: 'mentions-refund',
      label: 'Mentions Refund',
      score: REFUND_REGEX.test(output) ? 1 : 0,
      reason: 'Checks whether output mentions refund.',
    }),
  ],
  assert: ({ output, trace, cost }) => {
    assertEvalCondition(REFUND_REGEX.test(output), 'Output should mention refund');
    assertEvalCondition(
      trace.findSpan('refund-agent') !== undefined,
      'Trace should include the refund-agent span',
    );
    assertEvalCondition(
      trace.findSpansByKind('llm').length <= 6,
      'Trace should use at most 6 LLM turns',
    );
    assertEvalCondition(
      (cost.totalUsd ?? 0) < 0.10,
      'Eval cost should stay under $0.10',
    );
  },
  passThreshold: 0.5,
});

function assertEvalCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
