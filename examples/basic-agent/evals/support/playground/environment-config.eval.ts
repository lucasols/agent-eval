import {
  defineEval,
  evalSpan,
  evalTracer,
  getEvalCaseInput,
  nextEvalId,
  z,
} from '@ls-stack/agent-eval';

const defaultSupportQueue = 'standard-refund-queue';

type EnvironmentConfigInput = {
  customerTier: string;
  message: string;
  order: { id: string };
};

const environmentConfigOutputsSchema = z.object({
  generatedIds: z.array(z.string()),
  response: z.string(),
  queue: z.string(),
});

type EnvironmentConfigOutputs = z.infer<typeof environmentConfigOutputsSchema>;

function resolveSupportQueue(): string {
  const configuredQueue = process.env.AGENT_EVALS_SUPPORT_QUEUE;
  return configuredQueue && configuredQueue.length > 0
    ? configuredQueue
    : defaultSupportQueue;
}

defineEval<EnvironmentConfigInput, EnvironmentConfigOutputs>({
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
    generatedIds: { label: 'Generated IDs', format: 'json' },
    response: { label: 'Response', format: 'markdown' },
    queue: { label: 'Queue' },
  },
  outputsSchema: environmentConfigOutputsSchema,
  execute: async ({ input, setOutput }) => {
    await evalTracer.span(
      { kind: 'agent', name: 'environment-config-router' },
      () => {
        evalSpan.setAttribute('input', input);

        const queue = resolveSupportQueue();
        const scopedOrderId = getEvalCaseInput('order.id');
        const orderId =
          typeof scopedOrderId === 'string' ? scopedOrderId : input.order.id;
        const generatedIds = [nextEvalId(), nextEvalId()];
        const response = `Routed ${orderId} for ${input.customerTier} support via ${queue}.`;

        evalTracer.recordSpan({
          kind: 'api',
          name: 'fetch-support-routing-config',
          attributes: {
            method: 'GET',
            url: `https://support-config.local/queues/${input.customerTier}`,
            statusCode: 200,
            durationMs: 12,
            request: { customerTier: input.customerTier },
            response: { queue },
            headers: { 'x-config-version': '2026-04' },
            retryCount: 0,
            source: 'workspace-env',
          },
        });

        setOutput('generatedIds', generatedIds);
        setOutput('response', response);
        setOutput('queue', queue);
        evalSpan.setAttribute('output', { generatedIds, queue, response });
      },
    );
  },
  scores: {
    routedToQueue: {
      label: 'Routed to Queue',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.queue.length > 0 ? 1 : 0),
    },
  },
});
