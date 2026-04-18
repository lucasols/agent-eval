import {
  blocks,
  evalAssert,
  incrementOutput,
  setOutput,
  span,
  tracer,
} from '@agent-evals/sdk';
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
  return tracer.span(
    { kind: 'agent', name: 'receipt-fraud-review' },
    async () => {
      span.setAttribute('input', input);

      await tracer.span(
        { kind: 'tool', name: 'extract-receipt-metadata' },
        async () => {
          await waitForWorkflowDelay('extractReceiptMetadata');

          span.setAttributes({
            input: { path: input.receiptImage },
            output: {
              orderId: input.orderId,
              claimedAmountUsd: input.claimedAmountUsd,
            },
          });
        },
      );

      await tracer.span({ kind: 'llm', name: 'flag-tampering-signals' }, async () => {
        await waitForWorkflowDelay('flagTamperingSignals');

        const usage = { inputTokens: 240, outputTokens: 90 };
        const costUsd = calculateWorkflowCostUsd(usage);

        span.setAttributes({
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

        incrementOutput('costUsd', costUsd);
      });

      const result = await tracer.span(
        { kind: 'tool', name: 'open-risk-case' },
        async () => {
          await waitForWorkflowDelay('openRiskCase');

          const finalText = `Opened a risk review for order ${input.orderId} after detecting receipt tampering signals.`;
          span.setAttributes({
            input: { orderId: input.orderId },
            output: {
              finalText,
              reviewQueue: 'risk-ops',
              riskLevel: 'high',
            },
          });
          return {
            finalText,
            reviewQueue: 'risk-ops' as const,
            riskLevel: 'high' as const,
          };
        },
      );

      tracer.checkpoint('risk-escalation', { reviewQueue: result.reviewQueue });

      setOutput('response', [blocks.markdown(result.finalText)]);
      setOutput('reviewQueue', result.reviewQueue);
      setOutput('riskLevel', result.riskLevel);
      evalAssert(
        result.finalText.includes('risk review'),
        'receipt fraud review should describe the opened risk review',
      );

      span.setAttribute('output', result);
      return result;
    },
  );
}
