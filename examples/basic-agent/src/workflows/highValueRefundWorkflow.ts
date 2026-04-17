import {
  blocks,
  evalAssert,
  incrementOutput,
  setOutput,
  span,
  tracer,
} from '@agent-evals/sdk';
import { calculateWorkflowCostUsd } from './workflowCost.ts';

export type HighValueRefundInput = {
  customerMessage: string;
  loyaltyTier: 'standard' | 'vip';
  orderId: string;
  receiptImage: string;
  requestedRefundUsd: number;
};

export type HighValueRefundResult = {
  escalationQueue: 'finance-review';
  finalText: string;
  riskLevel: 'high';
};

export async function runHighValueRefundWorkflow(
  input: HighValueRefundInput,
): Promise<HighValueRefundResult> {
  return tracer.span({ kind: 'agent', name: 'high-value-refund' }, async () => {
    span.setAttribute('input', input);

    await tracer.span({ kind: 'llm', name: 'assess-refund-risk' }, () => {
      const usage = { inputTokens: 260, outputTokens: 80 };
      const costUsd = calculateWorkflowCostUsd(usage);

      span.setAttributes({
        input: {
          customerMessage: input.customerMessage,
          loyaltyTier: input.loyaltyTier,
          requestedRefundUsd: input.requestedRefundUsd,
        },
        model: 'gpt-4o-mini',
        usage,
        costUsd,
        output: {
          riskLevel: 'high',
          requiresManagerApproval: true,
        },
      });

      incrementOutput('costUsd', costUsd);
    });

    await tracer.span({ kind: 'tool', name: 'inspect-premium-receipt' }, () => {
      span.setAttributes({
        input: { path: input.receiptImage },
        output: {
          orderId: input.orderId,
          purchaseVerified: true,
        },
      });
    });

    const result = await tracer.span(
      { kind: 'tool', name: 'open-finance-escalation' },
      () => {
        const finalText = `Escalated a $${input.requestedRefundUsd.toFixed(2)} refund for order ${input.orderId} to finance review.`;
        span.setAttributes({
          input: { orderId: input.orderId },
          output: {
            escalationQueue: 'finance-review',
            finalText,
            riskLevel: 'high',
          },
        });
        return {
          escalationQueue: 'finance-review' as const,
          finalText,
          riskLevel: 'high' as const,
        };
      },
    );

    tracer.checkpoint('finance-escalation', {
      escalationQueue: result.escalationQueue,
    });

    setOutput('response', [blocks.markdown(result.finalText)]);
    setOutput('escalationQueue', result.escalationQueue);
    setOutput('riskLevel', result.riskLevel);
    evalAssert(
      result.finalText.includes('finance review'),
      'high value refunds should mention the finance review handoff',
    );

    span.setAttribute('output', result);
    return result;
  });
}
