import {
  evalAssert,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';
import { waitForWorkflowDelay } from './simulatedDelay.ts';

export type WorkflowInput = {
  message: string;
  locale?: string;
  receiptImage?: string;
  voiceNote?: string;
};

export type WorkflowResult = { finalText: string; approved: boolean };

const REFUND_REGEX = /refund/i;

export async function triggerWorkflow(
  input: WorkflowInput,
): Promise<WorkflowResult> {
  return evalTracer.span(
    { kind: 'agent', name: 'refund-workflow' },
    async () => {
      evalSpan.setAttribute('input', input);

      await evalTracer.span(
        {
          kind: 'llm',
          name: 'plan-refund',
          cache: {
            namespace: 'refund-workflow__plan-refund',
            key: { prompt: input.message, locale: input.locale },
          },
        },
        async () => {
          await waitForWorkflowDelay('planRefund');

          const usage = {
            inputTokens: 150,
            outputTokens: 50,
            cacheCreationInputTokens: 80,
            cachedInputTokens: 30,
          };

          evalSpan.setAttributes({
            input: { prompt: input.message },
            model: 'gpt-4o-mini',
            provider: 'openai',
            latencyMs: 72,
            usage,
            finishReason: 'stop',
            retryCount: 0,
            streamed: true,
            params: { temperature: 0.2 },
            output: { plan: 'approve refund' },
          });
        },
      );

      if (input.receiptImage) {
        await evalTracer.span(
          { kind: 'tool', name: 'inspect-receipt' },
          async () => {
            await waitForWorkflowDelay('inspectReceipt');

            evalSpan.setAttributes({
              input: { path: input.receiptImage },
              output: { verified: true },
            });
          },
        );
      }

      const result = await evalTracer.span(
        { kind: 'tool', name: 'process-refund' },
        async () => {
          await waitForWorkflowDelay('processRefund');

          const final = `Approved refund for: ${input.message}`;
          evalSpan.setAttributes({
            input: { message: input.message },
            output: { finalText: final, approved: true },
          });
          return { finalText: final, approved: true };
        },
      );

      evalTracer.checkpoint('decision', { approved: result.approved });

      setEvalOutput('response', result.finalText);
      evalAssert(
        REFUND_REGEX.test(result.finalText),
        'workflow output should mention refund',
      );

      evalSpan.setAttribute('output', result);
      return result;
    },
  );
}
