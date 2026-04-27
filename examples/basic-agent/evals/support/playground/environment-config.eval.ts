import {
  defineEval,
  evalSpan,
  evalTracer,
  getEvalCaseInput,
  setEvalOutput,
} from '@ls-stack/agent-eval';

const defaultSupportQueue = 'standard-refund-queue';

function resolveSupportQueue(): string {
  const configuredQueue = process.env.AGENT_EVALS_SUPPORT_QUEUE;
  return configuredQueue && configuredQueue.length > 0
    ? configuredQueue
    : defaultSupportQueue;
}

defineEval<{ customerTier: string; message: string; order: { id: string } }>({
  id: 'environment-config-demo',
  title: 'Environment Config Demo',
  cases: [
    {
      id: 'route-refund-by-env',
      input: {
        customerTier: 'gold',
        message: 'Customer needs a refund status update for a delayed order.',
        order: { id: 'R-2048' },
      },
    },
  ],
  columns: {
    response: { label: 'Response', format: 'markdown' },
    queue: { label: 'Queue' },
  },
  execute: async ({ input }) => {
    await evalTracer.span(
      { kind: 'agent', name: 'environment-config-router' },
      () => {
        evalSpan.setAttribute('input', input);

        const queue = resolveSupportQueue();
        const scopedOrderId = getEvalCaseInput('order.id');
        const orderId =
          typeof scopedOrderId === 'string' ? scopedOrderId : input.order.id;
        const response = `Routed ${orderId} for ${input.customerTier} support via ${queue}.`;

        setEvalOutput('response', response);
        setEvalOutput('queue', queue);
        evalSpan.setAttribute('output', { queue, response });
      },
    );
  },
  scores: {
    routedToQueue: {
      label: 'Routed to Queue',
      passThreshold: 1,
      compute: ({ outputs }) => (typeof outputs.queue === 'string' ? 1 : 0),
    },
  },
});
