import { defineEval } from '@agent-evals/sdk';
import {
  getTraceCounts,
  sharedTraceDisplay,
} from '../../../src/evals/exampleEvalUtils.ts';
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
  description: 'Exercises receipt-heavy refund reviews for support queues',
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
        customerMessage: 'The grinder attachment was missing from the bundle box.',
        expectedTotalUsd: 89,
        orderId: '#B-77',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
  ],
  columns: {
    response: { label: 'Summary', primary: true },
    auditStatus: { label: 'Audit Status' },
    discrepancyCount: { label: 'Discrepancies' },
    costUsd: { label: 'Cost', format: 'usd' },
    toolCalls: { label: 'Tool Calls' },
    llmTurns: { label: 'LLM Turns' },
  },
  traceDisplay: sharedTraceDisplay,
  execute: async ({ input }) => {
    await runReceiptAuditWorkflow(input);
  },
  deriveFromTracing: ({ trace }) => getTraceCounts(trace),
  scores: {
    receiptVerified: {
      label: 'Receipt Verified',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.auditStatus === 'verified' ? 1 : 0),
    },
  },
  passThreshold: 0.5,
});

defineEval<ReceiptFraudReviewInput>({
  id: 'receipt-fraud-review',
  title: 'Receipt Fraud Review',
  description: 'Escalates suspicious receipts into the fraud review queue',
  cases: [
    {
      id: 'tampered-total',
      input: {
        claimedAmountUsd: 312,
        customerMessage: 'The receipt total looks different from what accounting sees.',
        orderId: '#RISK-12',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
      },
    },
  ],
  columns: {
    response: { label: 'Summary', primary: true },
    reviewQueue: { label: 'Review Queue' },
    riskLevel: { label: 'Risk Level' },
    costUsd: { label: 'Cost', format: 'usd' },
    toolCalls: { label: 'Tool Calls' },
    llmTurns: { label: 'LLM Turns' },
  },
  traceDisplay: sharedTraceDisplay,
  execute: async ({ input }) => {
    await runReceiptFraudReviewWorkflow(input);
  },
  deriveFromTracing: ({ trace }) => getTraceCounts(trace),
  scores: {
    riskEscalated: {
      label: 'Risk Escalated',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.reviewQueue === 'risk-ops' ? 1 : 0),
    },
  },
  passThreshold: 0.5,
});
