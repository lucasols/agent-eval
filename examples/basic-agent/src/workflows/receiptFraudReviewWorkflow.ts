import {
  evalAssert,
  incrementEvalOutput,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';
import { waitForWorkflowDelay } from './simulatedDelay.ts';
import { calculateWorkflowCostUsd } from './workflowCost.ts';

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
        { kind: 'llm', name: 'flag-tampering-signals' },
        async () => {
          await waitForWorkflowDelay('flagTamperingSignals');

          const usage = { inputTokens: 240, outputTokens: 90 };
          const costUsd = calculateWorkflowCostUsd(usage);

          evalSpan.setAttributes({
            input: {
              customerMessage: input.customerMessage,
              claimedAmountUsd: input.claimedAmountUsd,
            },
            model: 'gpt-4o-mini',
            usage,
            costUsd,
            output: {
              riskLevel: 'high',
              tamperingSignals: ['edited_total', 'mismatched_font_weight'],
            },
          });

          incrementEvalOutput('costUsd', costUsd);
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
