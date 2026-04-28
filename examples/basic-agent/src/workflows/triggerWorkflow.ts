import {
  evalAssert,
  incrementEvalOutput,
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

const INPUT_PRICE_PER_MILLION = 2.5;
const OUTPUT_PRICE_PER_MILLION = 10;
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
          cache: { key: { prompt: input.message, locale: input.locale } },
        },
        async () => {
          await waitForWorkflowDelay('planRefund');

          const CACHE_WRITE_MULTIPLIER = 1.25;
          const CACHE_READ_MULTIPLIER = 0.1;
          const usage = {
            inputTokens: 150,
            outputTokens: 50,
            cacheCreationInputTokens: 80,
            cachedInputTokens: 30,
          };
          const inputCostUsd =
            (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
          const outputCostUsd =
            (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
          const cacheCreationInputCostUsd =
            (usage.cacheCreationInputTokens / 1_000_000) *
            INPUT_PRICE_PER_MILLION *
            CACHE_WRITE_MULTIPLIER;
          const cachedInputCostUsd =
            (usage.cachedInputTokens / 1_000_000) *
            INPUT_PRICE_PER_MILLION *
            CACHE_READ_MULTIPLIER;
          const costUsd =
            inputCostUsd +
            outputCostUsd +
            cacheCreationInputCostUsd +
            cachedInputCostUsd;

          evalSpan.setAttributes({
            input: { prompt: input.message },
            model: 'gpt-4o-mini',
            provider: 'openai',
            usage,
            costUsd,
            cost: {
              inputUsd: inputCostUsd,
              outputUsd: outputCostUsd,
              cacheCreationInputUsd: cacheCreationInputCostUsd,
              cachedInputUsd: cachedInputCostUsd,
            },
            steps: 1,
            finishReason: 'stop',
            tokensPerSecond: 38.2,
            retryCount: 0,
            streamed: true,
            params: { temperature: 0.2 },
            output: { plan: 'approve refund' },
          });

          incrementEvalOutput('costUsd', costUsd);
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
