export function track(event: string, data: Record<string, unknown>): void {
  console.info(`[analytics] ${event}`, data);
}
