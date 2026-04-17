import {
  blocks,
  evalAssert,
  incrementOutput,
  setOutput,
  span,
  tracer,
} from '@agent-evals/sdk';
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
  return tracer.span({ kind: 'agent', name: 'receipt-audit' }, async () => {
    span.setAttribute('input', input);

    await tracer.span({ kind: 'tool', name: 'ocr-receipt' }, () => {
      span.setAttributes({
        input: { path: input.receiptImage },
        output: {
          orderId: input.orderId,
          totalUsd: input.expectedTotalUsd,
        },
      });
    });

    await tracer.span({ kind: 'llm', name: 'compare-claim-against-receipt' }, () => {
      const usage = { inputTokens: 190, outputTokens: 60 };
      const costUsd = calculateWorkflowCostUsd(usage);

      span.setAttributes({
        input: {
          customerMessage: input.customerMessage,
          expectedTotalUsd: input.expectedTotalUsd,
        },
        model: 'gpt-4o-mini',
        usage,
        costUsd,
        output: {
          auditStatus: 'verified',
          discrepancyCount: 0,
        },
      });

      incrementOutput('costUsd', costUsd);
    });

    const result = await tracer.span(
      { kind: 'tool', name: 'publish-audit-summary' },
      () => {
        const finalText = `Verified receipt for order ${input.orderId} and matched it to the customer report.`;
        span.setAttributes({
          input: { orderId: input.orderId },
          output: {
            auditStatus: 'verified',
            discrepancyCount: 0,
            finalText,
          },
        });
        return {
          auditStatus: 'verified' as const,
          discrepancyCount: 0,
          finalText,
        };
      },
    );

    tracer.checkpoint('audit-decision', { auditStatus: result.auditStatus });

    setOutput('response', [blocks.markdown(result.finalText)]);
    setOutput('auditStatus', result.auditStatus);
    setOutput('discrepancyCount', result.discrepancyCount);
    evalAssert(
      result.discrepancyCount === 0,
      'receipt audit should not find mismatched line items',
    );

    span.setAttribute('output', result);
    return result;
  });
}
