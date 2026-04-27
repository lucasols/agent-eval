import {
  appendToEvalOutput,
  evalAssert,
  incrementEvalOutput,
  mergeEvalOutput,
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
    evalSpan.mergeAttribute('auditSummary', {
      orderId: input.orderId,
      expectedTotalUsd: input.expectedTotalUsd,
    });

    await evalTracer.span({ kind: 'tool', name: 'ocr-receipt' }, async () => {
      await waitForWorkflowDelay('ocrReceipt');

      evalSpan.appendToAttribute('auditEvents', 'receipt-ocr-complete');
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
        evalSpan.appendToAttribute('auditEvents', 'context-built');
        evalSpan.mergeAttribute('auditSummary', {
          claimType: context.claimType,
        });
        appendToEvalOutput('auditEvents', {
          step: 'context-built',
          orderId: input.orderId,
        });
        mergeEvalOutput('auditMetadata', {
          claimType: context.claimType,
          orderId: input.orderId,
        });
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

        evalSpan.incrementAttribute('reviewedReceipts', 1);
        incrementEvalOutput('costUsd', costUsd);
        appendToEvalOutput('auditEvents', {
          step: 'claim-compared',
          discrepancyCount: 0,
        });
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
        evalSpan.mergeAttribute('auditSummary', { auditStatus: 'verified' });
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
    mergeEvalOutput('auditMetadata', {
      auditStatus: result.auditStatus,
      discrepancyCount: result.discrepancyCount,
    });
    evalAssert(
      result.discrepancyCount === 0,
      'receipt audit should not find mismatched line items',
    );

    evalSpan.setAttribute('output', result);
    return result;
  });
}
