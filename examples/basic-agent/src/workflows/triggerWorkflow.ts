import {
  blocks,
  evalAssert,
  incrementOutput,
  setOutput,
  tracer,
} from '@agent-evals/sdk';

export type WorkflowInput = {
  message: string;
  locale?: string;
  receiptImage?: string;
  voiceNote?: string;
};

export type WorkflowResult = {
  finalText: string;
  approved: boolean;
};

const INPUT_PRICE_PER_MILLION = 2.5;
const OUTPUT_PRICE_PER_MILLION = 10;
const REFUND_REGEX = /refund/i;

export async function triggerWorkflow(
  input: WorkflowInput,
): Promise<WorkflowResult> {
  return tracer.span(
    { kind: 'agent', name: 'refund-workflow' },
    async (agentSpan) => {
      agentSpan.setInput(input);

      await tracer.span(
        { kind: 'llm', name: 'plan-refund' },
        (llmSpan) => {
          const usage = { inputTokens: 150, outputTokens: 50 };
          const costUsd =
            (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
            (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;

          llmSpan.setInput({ prompt: input.message });
          llmSpan.setUsage(usage);
          llmSpan.setCostUsd(costUsd);
          llmSpan.setOutput({ plan: 'approve refund' });

          incrementOutput('costUsd', costUsd);
        },
      );

      if (input.receiptImage) {
        await tracer.span(
          { kind: 'tool', name: 'inspect-receipt' },
          (toolSpan) => {
            toolSpan.setInput({ path: input.receiptImage });
            toolSpan.setOutput({ verified: true });
          },
        );
      }

      const result = await tracer.span(
        { kind: 'tool', name: 'process-refund' },
        (toolSpan) => {
          toolSpan.setInput({ message: input.message });
          const final = `Approved refund for: ${input.message}`;
          toolSpan.setOutput({ finalText: final, approved: true });
          return { finalText: final, approved: true };
        },
      );

      tracer.checkpoint('decision', { approved: result.approved });

      setOutput('response', [blocks.markdown(result.finalText)]);
      evalAssert(
        REFUND_REGEX.test(result.finalText),
        'workflow output should mention refund',
      );

      agentSpan.setOutput(result);
      return result;
    },
  );
}
