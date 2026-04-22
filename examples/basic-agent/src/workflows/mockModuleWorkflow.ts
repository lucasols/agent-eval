import { lookupCustomer } from './customerLookupGateway.ts';

export async function runMockModuleWorkflow(input: {
  customerId: string;
  request: string;
}): Promise<{ response: string; segment: 'standard' | 'vip' }> {
  const customer = await lookupCustomer(input.customerId);

  const response =
    customer.segment === 'vip'
      ? `Priority refund approved for ${input.customerId}: ${input.request}`
      : `Standard refund review required for ${input.customerId}: ${input.request}`;

  return { response, segment: customer.segment };
}
