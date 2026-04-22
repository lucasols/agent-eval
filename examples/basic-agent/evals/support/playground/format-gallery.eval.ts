import { readFileSync } from 'node:fs';
import { defineEval, setOutput } from '@ls-stack/agent-eval';

const previewCardSvg = readFileSync(
  new URL('../../datasets/assets/status-card.svg', import.meta.url),
);
const audioBriefWav = readFileSync(
  new URL('../../datasets/assets/chime.wav', import.meta.url),
);
const attachmentText = readFileSync(
  new URL('../../datasets/assets/refund-template.txt', import.meta.url),
);

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
    response: { label: 'Response', format: 'markdown' },
    toolResult: { label: 'Tool Result', format: 'json' },
    requiresManualReview: { label: 'Manual Review', format: 'boolean' },
    previewCard: { label: 'Preview Card', format: 'image', hideInTable: true },
    audioBrief: { label: 'Audio Brief', format: 'audio', hideInTable: true },
    attachment: { label: 'Attachment', format: 'file', hideInTable: true },
    confidence: { label: 'Confidence', format: 'percent' },
    handlingCostUsd: {
      label: 'Handling Cost',
      format: 'number',
      numberFormat: { prefix: '$', decimalPlaces: 2 },
    },
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
    setOutput('requiresManualReview', false);
    setOutput(
      'previewCard',
      new Blob([previewCardSvg], { type: 'image/svg+xml' }),
    );
    setOutput(
      'audioBrief',
      new File([audioBriefWav], 'chime.wav', { type: 'audio/wav' }),
    );
    setOutput(
      'attachment',
      new File([attachmentText], 'refund-template.txt', { type: 'text/plain' }),
    );
    setOutput('confidence', 0.93);
    setOutput('handlingCostUsd', 1.25);
    setOutput('reviewTimeMs', 1450);
  },
});
