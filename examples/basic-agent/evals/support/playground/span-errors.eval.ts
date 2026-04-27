import {
  captureEvalSpanError,
  defineEval,
  evalSpan,
  evalTracer,
  setEvalOutput,
} from '@ls-stack/agent-eval';

defineEval<{ orderId: string }>({
  id: 'captured-span-errors-demo',
  title: 'Captured Span Errors Demo',
  cases: [{ id: 'recover-with-fallback-signals', input: { orderId: '#771' } }],
  columns: {
    response: { label: 'Response', format: 'markdown' },
    fallbackSignals: { label: 'Fallback Signals', format: 'json' },
  },
  execute: async ({ input }) => {
    await evalTracer.span(
      { kind: 'agent', name: 'refund-risk-resilience' },
      async () => {
        evalSpan.setAttribute('input', input);

        await evalTracer.span(
          { kind: 'tool', name: 'load-optional-risk-signals' },
          () => {
            const fraudVelocityError = new Error(
              'Fraud velocity signal unavailable',
            );
            Object.assign(fraudVelocityError, {
              category: 'optional-signal',
              details: { fallback: 'loyaltyTier', signal: 'fraudVelocity' },
              domain: 'risk',
            });

            captureEvalSpanError([
              fraudVelocityError,
              {
                category: 'sla',
                details: { service: 'manualReviewSla', timeoutMs: 1500 },
                domain: 'operations',
                message: 'Manual review SLA lookup timed out',
                name: 'Error',
              },
            ]);

            const fallbackSignals = ['loyaltyTier', 'requestedRefundUsd'];
            evalSpan.setAttributes({
              input: { orderId: input.orderId },
              fallbackSignals,
              output: { source: 'fallback', riskLevel: 'review' },
            });

            setEvalOutput('fallbackSignals', fallbackSignals);
          },
        );

        const response = `Recovered risk review for order ${input.orderId} with fallback signals.`;
        setEvalOutput('response', response);
        evalSpan.setAttribute('output', { response });
      },
    );
  },
});

defineEval<{ orderId: string }>({
  id: 'errored-span-demo',
  title: 'Errored Span Demo',
  cases: [{ id: 'recover-after-webhook-error', input: { orderId: '#884' } }],
  columns: {
    response: { label: 'Response', format: 'markdown' },
    submitStatus: { label: 'Submit Status' },
    spanError: { label: 'Span Error' },
  },
  execute: async ({ input }) => {
    await evalTracer.span(
      { kind: 'agent', name: 'refund-webhook-recovery' },
      async () => {
        evalSpan.setAttribute('input', input);

        await evalTracer
          .span({ kind: 'tool', name: 'submit-refund-webhook' }, () => {
            evalSpan.setAttribute('input', { orderId: input.orderId });
            throw new Error(`Refund webhook rejected ${input.orderId}`);
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            setEvalOutput('spanError', message);
            setEvalOutput('submitStatus', 'queued-for-retry');
          });

        const response = `Queued a retry for order ${input.orderId} after webhook rejection.`;
        setEvalOutput('response', response);
        evalSpan.setAttribute('output', { response });
      },
    );
  },
});
