import { createHmac, timingSafeEqual } from 'node:crypto';

export const COMMAND_HMAC_VERSION = 'v1';

export type RepCommandHmacInput = {
  commandId: string;
  executionId: string;
  command: string;
  deviceId: string;
};

export function computeRepCommandHmac(secret: string, input: RepCommandHmacInput): string {
  const payload = [
    COMMAND_HMAC_VERSION,
    String(input.commandId || '').trim(),
    String(input.executionId || '').trim(),
    String(input.command || '').trim(),
    String(input.deviceId || '').trim(),
  ].join('|');
  return createHmac('sha256', String(secret || '')).update(payload, 'utf8').digest('hex');
}

export function verifyRepCommandHmac(secret: string, input: RepCommandHmacInput, signature: string): boolean {
  const expected = computeRepCommandHmac(secret, input);
  const provided = String(signature || '').trim();
  if (!provided) return false;
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function signRepCommandRow(
  secret: string,
  row: { id?: string; execution_id?: string | null; command?: string; device_id?: string },
): string {
  return computeRepCommandHmac(secret, {
    commandId: String(row.id || ''),
    executionId: String(row.execution_id || ''),
    command: String(row.command || ''),
    deviceId: String(row.device_id || ''),
  });
}
