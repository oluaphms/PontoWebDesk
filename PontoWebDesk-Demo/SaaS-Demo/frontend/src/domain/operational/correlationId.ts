export function createOperationalCorrelationId(): string {
  return crypto.randomUUID();
}
