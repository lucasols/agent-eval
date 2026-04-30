import {
  captureEvalSpanError,
  evalAssert,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';
import { waitForWorkflowDelay } from './simulatedDelay.ts';

export type ReceiptFraudReviewInput = {
  claimedAmountUsd: number;
  customerMessage: string;
  orderId: string;
  receiptImage: string;
};

export type ReceiptFraudReviewResult = {
  finalText: string;
  reviewQueue: 'risk-ops';
  riskLevel: 'high';
};

export async function runReceiptFraudReviewWorkflow(
  input: ReceiptFraudReviewInput,
): Promise<ReceiptFraudReviewResult> {
  return evalTracer.span(
    { kind: 'agent', name: 'receipt-fraud-review' },
    async () => {
      evalSpan.setAttribute('input', input);

      await evalTracer.span(
        { kind: 'tool', name: 'extract-receipt-metadata' },
        async () => {
          await waitForWorkflowDelay('extractReceiptMetadata');

          evalSpan.setAttributes({
            input: { path: input.receiptImage },
            output: {
              orderId: input.orderId,
              claimedAmountUsd: input.claimedAmountUsd,
            },
          });
        },
      );

      await evalTracer.span(
        { kind: 'llm', name: 'probe-vision-model' },
        async () => {
          await waitForWorkflowDelay('probeVisionModel');

          evalSpan.setAttributes({
            input: { receiptImage: input.receiptImage },
            model: 'gpt-4o-vision-preview',
            provider: 'openai',
            usage: { inputTokens: 0, outputTokens: 0 },
            finishReason: 'error',
            retryCount: 1,
            streamed: false,
          });

          captureEvalSpanError({
            name: 'ModelUnavailable',
            message:
              'The requested vision preview model returned 503; falling back to the text-only fraud reviewer.',
          });
        },
      );

      await evalTracer.span(
        { kind: 'llm', name: 'flag-tampering-signals' },
        async () => {
          await waitForWorkflowDelay('flagTamperingSignals');

          evalSpan.setAttributes({
            input: {
              customerMessage: input.customerMessage,
              claimedAmountUsd: input.claimedAmountUsd,
            },
            model: 'claude-3-5-sonnet',
            provider: 'anthropic',
            usage: { inputTokens: 240, outputTokens: 90 },
            finishReason: 'stop',
            retryCount: 2,
            streamed: true,
            params: { temperature: 0.1 },
            output: {
              riskLevel: 'high',
              tamperingSignals: ['edited_total', 'mismatched_font_weight'],
            },
          });

          captureEvalSpanError(
            {
              name: 'RateLimitRetried',
              message:
                'Provider returned 429 twice; succeeded on the third attempt with backoff.',
            },
            'warning',
          );
        },
      );

      const result = await evalTracer.span(
        { kind: 'tool', name: 'open-risk-case' },
        async () => {
          await waitForWorkflowDelay('openRiskCase');

          const finalText = `Opened a risk review for order ${input.orderId} after detecting receipt tampering signals.`;
          evalSpan.setAttributes({
            input: { orderId: input.orderId },
            output: { finalText, reviewQueue: 'risk-ops', riskLevel: 'high' },
          });
          return {
            finalText,
            reviewQueue: 'risk-ops' as const,
            riskLevel: 'high' as const,
          };
        },
      );

      evalTracer.checkpoint('risk-escalation', {
        reviewQueue: result.reviewQueue,
      });

      setEvalOutput('response', result.finalText);
      setEvalOutput('reviewQueue', result.reviewQueue);
      setEvalOutput('riskLevel', result.riskLevel);
      evalAssert(
        result.finalText.includes('risk review'),
        'receipt fraud review should describe the opened risk review',
      );

      evalSpan.setAttribute('output', result);
      return result;
    },
  );
}
