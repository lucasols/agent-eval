import { defineEval, repoFile, setOutput } from '@agent-evals/sdk';

defineEval({
  id: 'format-gallery',
  title: 'Format Gallery',
  cases: [
    {
      id: 'all-column-formats',
      input: {
        orderId: 'A-1024',
        customerMessage:
          'Please confirm the refund package for my damaged mug.',
      },
    },
  ],
  columns: {
    response: { label: 'Response', primary: true, format: 'markdown' },
    toolResult: { label: 'Tool Result', format: 'json' },
    previewCard: { label: 'Preview Card', format: 'image' },
    audioBrief: { label: 'Audio Brief', format: 'audio' },
    attachment: { label: 'Attachment', format: 'file' },
    confidence: { label: 'Confidence', format: 'percent' },
    handlingCostUsd: { label: 'Handling Cost', format: 'usd' },
    reviewTimeMs: { label: 'Review Time', format: 'duration' },
  },
  execute: ({ input }) => {
    setOutput(
      'response',
      `Prepared **refund package** for order \`${input.orderId}\`.\n\nCustomer note: ${input.customerMessage}`,
    );
    setOutput('toolResult', {
      orderId: input.orderId,
      matchedReceipt: true,
      nextStep: 'send-refund-confirmation',
      reviewer: { name: 'Avery', queue: 'refund-ops' },
    });
    setOutput(
      'previewCard',
      repoFile('evals/datasets/assets/status-card.svg', 'image/svg+xml'),
    );
    setOutput(
      'audioBrief',
      repoFile('evals/datasets/assets/chime.wav', 'audio/wav'),
    );
    setOutput(
      'attachment',
      repoFile('evals/datasets/assets/refund-template.txt', 'text/plain'),
    );
    setOutput('confidence', 0.93);
    setOutput('handlingCostUsd', 1.25);
    setOutput('reviewTimeMs', 1450);
  },
});
