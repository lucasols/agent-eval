import { mock } from 'node:test';
import { defineEval, evalAssert, setOutput } from '@agent-evals/sdk';

defineEval<{ customerId: string; request: string }>({
  id: 'module-mock-demo',
  title: 'Module Mock Demo',
  cases: [
    {
      id: 'mocked-customer-lookup',
      input: {
        customerId: 'vip-100',
        request: 'Please refund the duplicate charge',
      },
    },
  ],
  columns: {
    response: { label: 'Response', primary: true, format: 'markdown' },
    appliedSegment: { label: 'Applied Segment' },
  },
  execute: async ({ input }) => {
    mock.module('../../../src/workflows/customerLookupGateway.ts', {
      namedExports: {
        lookupCustomer: () =>
          Promise.resolve({
            segment: 'vip' as const,
            summary: `Loaded mocked profile for ${input.customerId}`,
          }),
      },
    });

    const { runMockModuleWorkflow } =
      await import('../../../src/workflows/mockModuleWorkflow.ts');
    const result = await runMockModuleWorkflow(input);

    setOutput('response', result.response);
    setOutput('appliedSegment', result.segment);

    evalAssert(
      result.segment === 'vip',
      'module mock should replace the customer lookup dependency',
    );
  },
  scores: {
    usedVipSegment: {
      label: 'Used VIP Segment',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.appliedSegment === 'vip' ? 1 : 0),
    },
  },
});
