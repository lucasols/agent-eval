import { readFileSync } from 'node:fs';
import {
  defineEval,
  evalLog,
  evalSpan,
  evalTime,
  evalTracer,
  setEvalOutput,
} from '@ls-stack/agent-eval';

const previewCardSvg = readFileSync(
  new URL('../../datasets/assets/status-card.svg', import.meta.url),
);
const previewCardUrl = new URL(
  '../../datasets/assets/status-card.svg',
  import.meta.url,
).href;
const audioBriefWav = readFileSync(
  new URL('../../datasets/assets/chime.wav', import.meta.url),
);
const attachmentText = readFileSync(
  new URL('../../datasets/assets/refund-template.txt', import.meta.url),
);

const htmlReport = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Refund Package Report</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 32px; color: #0a0b0d; }
      h1 { font-size: 24px; margin: 0 0 12px; }
      .status { display: inline-block; padding: 4px 8px; border: 1px solid #16a34a; border-radius: 6px; color: #166534; }
      table { border-collapse: collapse; margin-top: 20px; width: 100%; }
      th, td { border: 1px solid #e8e8eb; padding: 10px; text-align: left; }
    </style>
  </head>
  <body>
    <h1>Refund Package Report</h1>
    <span class="status">Ready for review</span>
    <table>
      <tr><th>Order</th><td>A-1024</td></tr>
      <tr><th>Next step</th><td>Send confirmation from the refund queue</td></tr>
      <tr><th>Confidence</th><td>93%</td></tr>
    </table>
  </body>
</html>`;

function createRefundSummaryPdf(): Uint8Array<ArrayBuffer> {
  const stream = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    '(Refund Package Report) Tj',
    '/F1 12 Tf',
    '0 -32 Td',
    '(Order A-1024 is ready for review.) Tj',
    '0 -20 Td',
    '(Next step: send confirmation from the refund queue.) Tj',
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj',
    `4 0 obj\n<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
  ];
  const offsets: number[] = [];
  let pdf = '%PDF-1.4\n';
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }
  const xrefStart = pdf.length;
  const entries = offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
    .join('\n');
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${entries}\ntrailer\n<< /Size ${String(
    objects.length + 1,
  )} /Root 1 0 R >>\nstartxref\n${String(xrefStart)}\n%%EOF\n`;
  return new Uint8Array(new TextEncoder().encode(pdf));
}

defineEval({
  id: 'format-gallery',
  title: 'Format Gallery',
  startTime: '2024-01-02T03:04:05.000Z',
  freezeTime: true,
  cases: [
    {
      id: 'all-column-formats',
      input: {
        orderId: 'A-1024',
        customerMessage:
          'Please confirm the refund package for my damaged mug.',
        prompt: {
          data: {
            test: 'Please confirm the refund package for my damaged mug.',
          },
        },
        visualReferenceUrls: [previewCardUrl],
      },
    },
  ],
  inputSections: {
    customerPrompt: {
      path: 'prompt.data.test',
      label: 'Customer prompt',
      format: 'markdown',
    },
    visualReferences: {
      path: 'visualReferenceUrls',
      label: 'Visual references',
    },
    orderSummary: (input) => `Order ${input.orderId}`,
  },
  columns: {
    response: { label: 'Response', format: 'markdown' },
    plainTextSummary: { label: 'Plain Text Summary' },
    inferredMarkdownSummary: { label: 'Inferred Markdown Summary' },
    toolResult: { label: 'Tool Result', format: 'json' },
    requiresManualReview: { label: 'Manual Review', format: 'boolean' },
    previewCard: { label: 'Preview Card', format: 'image', hideInTable: true },
    htmlReport: { label: 'HTML Report', format: 'html', hideInTable: true },
    pdfReport: { label: 'PDF Report', format: 'pdf', hideInTable: true },
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
    generatedAt: { label: 'Generated At' },
    reviewQueuedAt: { label: 'Review Queued At' },
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
            cache: {
              namespace: 'format-gallery.auto-quality-review',
              key: { response: outputs.response, rubricVersion: 1 },
            },
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
      description:
        'Confirm the prepared refund package is ready to send and does not need escalation.',
      format: 'passFail',
      passThreshold: 0.5,
    },
    reviewerQuality: {
      label: 'Reviewer Quality',
      description:
        'Rate whether the response, attachments, and next-step guidance are complete for a support reviewer.',
      format: 'stars',
      maxStars: 5,
    },
  },
  execute: ({ input, setOutput }) => {
    evalLog('info', 'Preparing format gallery package for %s', input.orderId);
    console.info('Loaded refund package assets', {
      previewBytes: previewCardSvg.byteLength,
      audioBytes: audioBriefWav.byteLength,
    });
    setEvalOutput(
      'response',
      `Prepared **refund package** for order \`${input.orderId}\`.\n\nCustomer note: ${input.customerMessage}`,
    );
    setEvalOutput(
      'plainTextSummary',
      `Order: ${input.orderId}\nStatus: refund package ready\nNext step: send confirmation`,
    );
    setEvalOutput(
      'inferredMarkdownSummary',
      `- Order \`${input.orderId}\` is ready for review\n- Confirmation can be sent from the refund queue`,
    );
    setEvalOutput('toolResult', {
      orderId: input.orderId,
      matchedReceipt: true,
      nextStep: 'send-refund-confirmation',
      reviewer: { name: 'Avery', queue: 'refund-ops' },
    });
    setOutput(
      'rawToolEvents',
      [
        {
          name: 'receipt-match',
          status: 'passed',
          textWithLineBreaks: 'Matched receipt\nAmount: $15.99',
        },
        { name: 'queue-routing', status: 'ready' },
      ],
      { label: 'Raw Tool Events', format: 'json', hideInTable: true },
    );
    setEvalOutput('requiresManualReview', false);
    setEvalOutput(
      'previewCard',
      new Blob([previewCardSvg], { type: 'image/svg+xml' }),
    );
    setEvalOutput(
      'htmlReport',
      new File([htmlReport], 'refund-report.html', { type: 'text/html' }),
    );
    setEvalOutput(
      'pdfReport',
      new File([createRefundSummaryPdf()], 'refund-report.pdf', {
        type: 'application/pdf',
      }),
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
    setEvalOutput('generatedAt', evalTime.startTime.toISOString());
    setEvalOutput(
      'reviewQueuedAt',
      evalTime.advance(15, 'minutes').toISOString(),
    );
  },
});
