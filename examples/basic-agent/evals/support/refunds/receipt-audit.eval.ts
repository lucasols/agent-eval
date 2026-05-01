import { defineEval, evalTracer } from '@ls-stack/agent-eval';
import { sharedTraceDisplay } from '../../../src/evals/exampleEvalUtils.ts';
import {
  runReceiptAuditWorkflow,
  type ReceiptAuditInput,
} from '../../../src/workflows/receiptAuditWorkflow.ts';
import {
  runReceiptFraudReviewWorkflow,
  type ReceiptFraudReviewInput,
} from '../../../src/workflows/receiptFraudReviewWorkflow.ts';

defineEval<ReceiptAuditInput>({
  id: 'receipt-audit',
  title: 'Receipt Audit',
  cases: [
    {
      id: 'damaged-mug',
      input: {
        customerMessage: 'The mug arrived chipped and the handle was cracked.',
        expectedTotalUsd: 24.5,
        orderId: '#A-18',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
    {
      id: 'bundle-attachment-audit',
      input: {
        customerMessage:
          'The grinder attachment was missing from the bundle box.',
        expectedTotalUsd: 89,
        orderId: '#B-77',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
  ],
  columns: {
    response: { label: 'Summary', format: 'markdown' },
    auditStatus: { label: 'Audit Status' },
    auditEvents: { label: 'Audit Events', format: 'json' },
    auditMetadata: { label: 'Audit Metadata', format: 'json' },
    discrepancyCount: { label: 'Discrepancies' },
    costUsd: {
      label: 'Cost',
      format: 'number',
      numberFormat: { prefix: '$', minDecimalPlaces: 4, maxDecimalPlaces: 4 },
    },
  },
  traceDisplay: sharedTraceDisplay,
  execute: async ({ input }) => {
    await evalTracer.cache(
      { name: 'audit-policy-snapshot', key: { orderId: input.orderId } },
      () => ({ policyVersion: '2026.04', strictMode: true }),
    );
    await runReceiptAuditWorkflow(input);
  },
  scores: {
    receiptVerified: {
      label: 'Receipt Verified',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.auditStatus === 'verified' ? 1 : 0),
    },
  },
});

defineEval<ReceiptFraudReviewInput>({
  id: 'receipt-fraud-review',
  title: 'Receipt Fraud Review',
  cases: [
    {
      id: 'tampered-total',
      input: {
        claimedAmountUsd: 312,
        customerMessage:
          'The receipt total looks different from what accounting sees.',
        orderId: '#RISK-12',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
  ],
  columns: {
    response: { label: 'Summary', format: 'markdown' },
    reviewQueue: { label: 'Review Queue' },
    riskLevel: { label: 'Risk Level' },
    costUsd: {
      label: 'Cost',
      format: 'number',
      numberFormat: { prefix: '$', minDecimalPlaces: 4, maxDecimalPlaces: 4 },
    },
  },
  traceDisplay: sharedTraceDisplay,
  execute: async ({ input }) => {
    await runReceiptFraudReviewWorkflow(input);
  },
  scores: {
    riskEscalated: {
      label: 'Risk Escalated',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.reviewQueue === 'risk-ops' ? 1 : 0),
    },
  },
});
