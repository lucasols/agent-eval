import { defineEval, blocks, repoFile, installEvalMatchers, estimateCost, createPriceRegistry } from '@agent-evals/sdk';
import { expect, vi } from 'vitest';

installEvalMatchers();

vi.mock('../src/analytics', () => ({
  track: vi.fn(),
}));

const pricing = createPriceRegistry({
  'gpt-4o': {
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10,
  },
});

defineEval({
  id: 'refund-agent',
  title: 'Refund Agent',
  description: 'Tests the refund agent with various input types',
  data: async () => [
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
  ],
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

        const agentResult = await trace.span(
          { kind: 'llm', name: 'plan-refund' },
          async (llmSpan) => {
            llmSpan.setInput({ prompt: input.message });
            llmSpan.setUsage({ inputTokens: 150, outputTokens: 50 });
            const cost = estimateCost('gpt-4o', { inputTokens: 150, outputTokens: 50 }, pricing);
            llmSpan.setCostUsd(cost);
            llmSpan.setOutput({ plan: 'approve refund' });
            return { plan: 'approve refund' };
          },
        );

        const toolResult = await trace.span(
          { kind: 'tool', name: 'process-refund' },
          async (toolSpan) => {
            toolSpan.setInput({ action: 'refund', orderId: '#123' });
            toolSpan.setOutput({ success: true });
            return { success: true };
          },
        );

        const finalText = `Approved refund for: ${input.message}`;
        span.setOutput({ finalText, toolCalls: 2 });

        return { finalText, toolCalls: 2 };
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
    async ({ output }) => ({
      id: 'mentions-refund',
      label: 'Mentions Refund',
      score: /refund/i.test(output) ? 1 : 0,
      reason: 'Checks whether output mentions refund.',
    }),
  ],
  assert: ({ output, trace, cost }) => {
    expect(output).toMatch(/refund/i);
    expect(trace).toCallSpan('refund-agent');
    expect(trace).toUseAtMostTurns(6);
    expect((cost.totalUsd ?? 0) < 0.10).toBe(true);
  },
  passThreshold: 0.5,
});
