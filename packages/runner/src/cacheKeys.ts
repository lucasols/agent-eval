export function toPendingKey(namespace: string, keyHash: string): string {
  return `${namespace}::${keyHash}`;
}
