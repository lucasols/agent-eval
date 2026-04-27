import {
  evalAssert,
  incrementEvalOutput,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';
import { waitForWorkflowDelay } from './simulatedDelay.ts';
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
  return evalTracer.span(
    { kind: 'agent', name: 'high-value-refund' },
    async () => {
      evalSpan.setAttribute('input', input);

      const policySpan = evalTracer.startSpan({
        kind: 'retrieval',
        name: 'premium-refund-policy-snapshot',
        attributes: {
          input: {
            loyaltyTier: input.loyaltyTier,
            requestedRefundUsd: input.requestedRefundUsd,
          },
        },
      });
      policySpan.setAttribute('source', 'finance-policy-ledger');
      policySpan.end({
        attributes: {
          output: { managerApprovalRequiredUsd: 500, queue: 'finance-review' },
        },
      });

      await evalTracer.span(
        { kind: 'llm', name: 'assess-refund-risk' },
        async () => {
          await waitForWorkflowDelay('assessRefundRisk');

          const usage = { inputTokens: 260, outputTokens: 80 };
          const costUsd = calculateWorkflowCostUsd(usage);

          evalSpan.setAttributes({
            input: {
              customerMessage: input.customerMessage,
              loyaltyTier: input.loyaltyTier,
              requestedRefundUsd: input.requestedRefundUsd,
            },
            model: 'gpt-4o-mini',
            usage,
            costUsd,
            output: { riskLevel: 'high', requiresManagerApproval: true },
          });

          incrementEvalOutput('costUsd', costUsd);
        },
      );

      await evalTracer.span(
        { kind: 'tool', name: 'inspect-premium-receipt' },
        async () => {
          await waitForWorkflowDelay('inspectPremiumReceipt');

          evalSpan.setAttributes({
            input: { path: input.receiptImage },
            output: { orderId: input.orderId, purchaseVerified: true },
          });
        },
      );

      const result = await evalTracer.span(
        { kind: 'tool', name: 'open-finance-escalation' },
        async () => {
          await waitForWorkflowDelay('openFinanceEscalation');

          const finalText = `Escalated a $${input.requestedRefundUsd.toFixed(2)} refund for order ${input.orderId} to finance review.`;
          evalSpan.setAttributes({
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

      evalTracer.checkpoint('finance-escalation', {
        escalationQueue: result.escalationQueue,
      });

      setEvalOutput('response', result.finalText);
      setEvalOutput('escalationQueue', result.escalationQueue);
      setEvalOutput('riskLevel', result.riskLevel);
      evalAssert(
        result.finalText.includes('finance review'),
        'high value refunds should mention the finance review handoff',
      );

      evalSpan.setAttribute('output', result);
      return result;
    },
  );
}
