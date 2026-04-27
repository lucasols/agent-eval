import {
  evalAssert,
  incrementEvalOutput,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';
import { waitForWorkflowDelay } from './simulatedDelay.ts';
import { calculateWorkflowCostUsd } from './workflowCost.ts';

export type ReceiptAuditInput = {
  orderId: string;
  customerMessage: string;
  receiptImage: string;
  expectedTotalUsd: number;
};

export type ReceiptAuditResult = {
  auditStatus: 'verified';
  discrepancyCount: number;
  finalText: string;
};

export async function runReceiptAuditWorkflow(
  input: ReceiptAuditInput,
): Promise<ReceiptAuditResult> {
  return evalTracer.span({ kind: 'agent', name: 'receipt-audit' }, async () => {
    evalSpan.setAttribute('input', input);

    await evalTracer.span({ kind: 'tool', name: 'ocr-receipt' }, async () => {
      await waitForWorkflowDelay('ocrReceipt');

      evalSpan.setAttributes({
        input: { path: input.receiptImage },
        output: { orderId: input.orderId, totalUsd: input.expectedTotalUsd },
      });
    });

    const receiptContext = await evalTracer.cache(
      {
        name: 'receipt-audit-context',
        key: {
          customerMessage: input.customerMessage,
          expectedTotalUsd: input.expectedTotalUsd,
          orderId: input.orderId,
        },
      },
      () => {
        const context = {
          claimType: 'damage',
          expectedTotalUsd: input.expectedTotalUsd,
          orderId: input.orderId,
        };
        evalSpan.setAttribute('receiptContext', context);
        evalTracer.checkpoint('receipt-audit-context', context);
        return context;
      },
    );

    await evalTracer.span(
      { kind: 'llm', name: 'compare-claim-against-receipt' },
      async () => {
        await waitForWorkflowDelay('compareClaimAgainstReceipt');

        const usage = { inputTokens: 190, outputTokens: 60 };
        const costUsd = calculateWorkflowCostUsd(usage);

        evalSpan.setAttributes({
          input: {
            customerMessage: input.customerMessage,
            expectedTotalUsd: receiptContext.expectedTotalUsd,
          },
          model: 'gpt-4o-mini',
          usage,
          costUsd,
          output: { auditStatus: 'verified', discrepancyCount: 0 },
        });

        incrementEvalOutput('costUsd', costUsd);
      },
    );

    const result = await evalTracer.span(
      { kind: 'tool', name: 'publish-audit-summary' },
      async () => {
        await waitForWorkflowDelay('publishAuditSummary');

        const finalText = `Verified receipt for order ${input.orderId} and matched it to the customer report.`;
        evalSpan.setAttributes({
          input: { orderId: input.orderId },
          output: { auditStatus: 'verified', discrepancyCount: 0, finalText },
        });
        return {
          auditStatus: 'verified' as const,
          discrepancyCount: 0,
          finalText,
        };
      },
    );

    evalTracer.checkpoint('audit-decision', {
      auditStatus: result.auditStatus,
    });

    setEvalOutput('response', result.finalText);
    setEvalOutput('auditStatus', result.auditStatus);
    setEvalOutput('discrepancyCount', result.discrepancyCount);
    evalAssert(
      result.discrepancyCount === 0,
      'receipt audit should not find mismatched line items',
    );

    evalSpan.setAttribute('output', result);
    return result;
  });
}
