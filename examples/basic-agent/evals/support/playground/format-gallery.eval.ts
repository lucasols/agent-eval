import { readFileSync } from 'node:fs';
import {
  defineEval,
  evalLog,
  evalSpan,
  evalTracer,
  setEvalOutput,
} from '@ls-stack/agent-eval';

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
    automatedQuality: { label: 'Auto Quality', format: 'stars', maxStars: 5 },
    handlingCostUsd: {
      label: 'Handling Cost',
      format: 'number',
      numberFormat: { prefix: '$', minDecimalPlaces: 2, maxDecimalPlaces: 2 },
    },
    requestCount: {
      label: 'Requests',
      format: 'number',
      numberFormat: {
        notation: 'compact',
        minDecimalPlaces: 1,
        maxDecimalPlaces: 1,
      },
    },
    reviewTimeMs: { label: 'Review Time', format: 'duration' },
  },
  stats: [
    {
      kind: 'column',
      key: 'handlingCostUsd',
      label: 'Avg Handling Cost',
      aggregate: 'avg',
      format: 'number',
      numberFormat: { prefix: '$', minDecimalPlaces: 2, maxDecimalPlaces: 2 },
    },
    {
      kind: 'column',
      key: 'requestCount',
      label: 'Requests',
      aggregate: 'sum',
      format: 'number',
      numberFormat: {
        notation: 'compact',
        minDecimalPlaces: 1,
        maxDecimalPlaces: 1,
      },
    },
  ],
  scores: {
    automatedQuality: {
      label: 'Auto Quality',
      format: 'stars',
      maxStars: 5,
      compute: async ({ outputs }) => {
        const score = await evalTracer.span(
          {
            kind: 'scorer',
            name: 'auto-quality-review',
            cache: { key: { response: outputs.response, rubricVersion: 1 } },
          },
          () => {
            evalSpan.setAttributes({
              rubric: 'refund-package-completeness',
              decision: 'ready-for-review',
            });
            return 0.8;
          },
        );

        return typeof score === 'number' ? score : 0;
      },
    },
  },
  manualScores: {
    reviewerDecision: {
      label: 'Reviewer Decision',
      format: 'passFail',
      passThreshold: 0.5,
    },
    reviewerQuality: {
      label: 'Reviewer Quality',
      format: 'stars',
      maxStars: 5,
    },
  },
  execute: ({ input }) => {
    evalLog('info', 'Preparing format gallery package for %s', input.orderId);
    console.info('Loaded refund package assets', {
      previewBytes: previewCardSvg.byteLength,
      audioBytes: audioBriefWav.byteLength,
    });
    setEvalOutput(
      'response',
      `Prepared **refund package** for order \`${input.orderId}\`.\n\nCustomer note: ${input.customerMessage}`,
    );
    setEvalOutput('toolResult', {
      orderId: input.orderId,
      matchedReceipt: true,
      nextStep: 'send-refund-confirmation',
      reviewer: { name: 'Avery', queue: 'refund-ops' },
    });
    setEvalOutput('requiresManualReview', false);
    setEvalOutput(
      'previewCard',
      new Blob([previewCardSvg], { type: 'image/svg+xml' }),
    );
    setEvalOutput(
      'audioBrief',
      new File([audioBriefWav], 'chime.wav', { type: 'audio/wav' }),
    );
    setEvalOutput(
      'attachment',
      new File([attachmentText], 'refund-template.txt', { type: 'text/plain' }),
    );
    setEvalOutput('confidence', 0.93);
    setEvalOutput('handlingCostUsd', 1.25);
    setEvalOutput('requestCount', 1200);
    setEvalOutput('reviewTimeMs', 1450);
  },
});
