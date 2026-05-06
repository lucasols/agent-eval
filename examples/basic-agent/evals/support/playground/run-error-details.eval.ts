import { readFile } from 'node:fs/promises';
import { defineEval, setEvalOutput } from '@ls-stack/agent-eval';

async function loadRefundPolicyDataset(): Promise<string> {
  return await readFile(
    new URL(
      '../../datasets/run-error/refund-policy-cases.json',
      import.meta.url,
    ),
    'utf-8',
  );
}

defineEval<{ ticketId: string }>({
  id: 'run-error-details-demo',
  title: 'Run Error Details Demo',
  cases: async () => {
    const refundPolicyDataset = await loadRefundPolicyDataset();

    return [
      {
        id: 'policy-dataset-loads',
        input: { ticketId: `T-${String(refundPolicyDataset.length)}` },
      },
    ];
  },
  columns: { response: { label: 'Response', format: 'markdown' } },
  execute: ({ input }) => {
    setEvalOutput(
      'response',
      `Loaded refund policy dataset for ${input.ticketId}.`,
    );
  },
});
