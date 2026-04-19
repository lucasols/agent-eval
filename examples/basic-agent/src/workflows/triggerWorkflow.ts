import {
  blocks,
  evalAssert,
  incrementOutput,
  setOutput,
  span,
  tracer,
} from '@agent-evals/sdk';
import { waitForWorkflowDelay } from './simulatedDelay.ts';

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
    span.setAttribute('input', input);

    await tracer.span(
      {
        kind: 'llm',
        name: 'plan-refund',
        cache: { key: { prompt: input.message, locale: input.locale } },
      },
      async () => {
        await waitForWorkflowDelay('planRefund');

        const usage = { inputTokens: 150, outputTokens: 50 };
        const costUsd =
          (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION
          + (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;

        span.setAttributes({
          input: { prompt: input.message },
          model: 'gpt-4o-mini',
          usage,
          costUsd,
          output: { plan: 'approve refund' },
        });

        incrementOutput('costUsd', costUsd);
      },
    );

    if (input.receiptImage) {
      await tracer.span({ kind: 'tool', name: 'inspect-receipt' }, async () => {
        await waitForWorkflowDelay('inspectReceipt');

        span.setAttributes({
          input: { path: input.receiptImage },
          output: { verified: true },
        });
      });
    }

    const result = await tracer.span(
      { kind: 'tool', name: 'process-refund' },
      async () => {
        await waitForWorkflowDelay('processRefund');

        const final = `Approved refund for: ${input.message}`;
        span.setAttributes({
          input: { message: input.message },
          output: { finalText: final, approved: true },
        });
        return { finalText: final, approved: true };
      },
    );

    tracer.checkpoint('decision', { approved: result.approved });

    setOutput('response', [blocks.markdown(result.finalText)]);
    evalAssert(
      REFUND_REGEX.test(result.finalText),
      'workflow output should mention refund',
    );

    span.setAttribute('output', result);
    return result;
  });
}
