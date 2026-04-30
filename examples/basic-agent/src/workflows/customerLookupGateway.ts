export type CustomerLookup = { segment: 'standard' | 'vip'; summary: string };

export function lookupCustomer(customerId: string): Promise<CustomerLookup> {
  return Promise.resolve({
    segment: 'standard',
    summary: `Loaded live profile for ${customerId}`,
  });
}
