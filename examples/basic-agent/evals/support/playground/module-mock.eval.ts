import { mock } from 'node:test';
import { defineEval, evalExpect, setEvalOutput } from '@ls-stack/agent-eval';

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
    response: { label: 'Response', format: 'markdown' },
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

    setEvalOutput('response', result.response);
    setEvalOutput('appliedSegment', result.segment);

    evalExpect(result.segment).toBe('vip');
  },
  scores: {
    usedVipSegment: {
      label: 'Used VIP Segment',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.appliedSegment === 'vip' ? 1 : 0),
    },
  },
});
