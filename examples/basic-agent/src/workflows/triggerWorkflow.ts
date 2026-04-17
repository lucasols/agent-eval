import {
  blocks,
  evalAssert,
  incrementOutput,
  setOutput,
  span,
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
  return tracer.span({ kind: 'agent', name: 'refund-workflow' }, async () => {
    span.setInput(input);

    await tracer.span({ kind: 'llm', name: 'plan-refund' }, () => {
      const usage = { inputTokens: 150, outputTokens: 50 };
      const costUsd =
        (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
        (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;

      span.setInput({ prompt: input.message });
      span.setAttribute('model', 'gpt-4o-mini');
      span.setUsage(usage);
      span.setCostUsd(costUsd);
      span.setOutput({ plan: 'approve refund' });

      incrementOutput('costUsd', costUsd);
    });

    if (input.receiptImage) {
      await tracer.span({ kind: 'tool', name: 'inspect-receipt' }, () => {
        span.setInput({ path: input.receiptImage });
        span.setOutput({ verified: true });
      });
    }

    const result = await tracer.span(
      { kind: 'tool', name: 'process-refund' },
      () => {
        span.setInput({ message: input.message });
        const final = `Approved refund for: ${input.message}`;
        span.setOutput({ finalText: final, approved: true });
        return { finalText: final, approved: true };
      },
    );

    tracer.checkpoint('decision', { approved: result.approved });

    setOutput('response', [blocks.markdown(result.finalText)]);
    evalAssert(
      REFUND_REGEX.test(result.finalText),
      'workflow output should mention refund',
    );

    span.setOutput(result);
    return result;
  });
}
