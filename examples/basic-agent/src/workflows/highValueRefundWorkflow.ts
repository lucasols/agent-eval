import {
  evalAssert,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';
import { waitForWorkflowDelay } from './simulatedDelay.ts';

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
        kind: 'policy.retrieval',
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

          const usage = {
            inputTokens: 260,
            outputTokens: 80,
            reasoningTokens: 320,
          };

          evalSpan.setAttributes({
            input: {
              customerMessage: input.customerMessage,
              loyaltyTier: input.loyaltyTier,
              requestedRefundUsd: input.requestedRefundUsd,
            },
            model: 'o1-mini',
            provider: 'openai',
            usage,
            finishReason: 'stop',
            retryCount: 0,
            streamed: false,
            params: { temperature: 0 },
            reasoning:
              'Premium loyalty status raises refund authority but the requested amount exceeds the manager-approval threshold. Receipt verification still pending so escalate to finance review rather than auto-approving.',
            output: { riskLevel: 'high', requiresManagerApproval: true },
          });
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

      await evalTracer.span(
        { kind: 'llm', name: 'summarize-finance-handoff' },
        async () => {
          await waitForWorkflowDelay('summarizeFinanceHandoff');

          evalSpan.setAttributes({
            input: {
              orderId: input.orderId,
              loyaltyTier: input.loyaltyTier,
              requestedRefundUsd: input.requestedRefundUsd,
            },
            model: 'gpt-4o-mini',
            provider: 'openai',
            usage: { inputTokens: 540, outputTokens: 256 },
            finishReason: 'length',
            retryCount: 0,
            streamed: true,
            params: { temperature: 0.3, maxOutputTokens: 256 },
            output: {
              draftSummary:
                'VIP customer requesting a refund well above the manager threshold. Receipt verified, escalation routing prepared. Suggest finance reviewer pull last 90 days of order history before...',
              truncated: true,
            },
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
