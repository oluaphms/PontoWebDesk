/**
 * HMAC de comandos REP remotos — deve coincidir com backend repCommandHmacService.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COMMAND_HMAC_VERSION = 'v1';

/**
 * @param {string} apiKey
 * @param {{ commandId: string, executionId: string, command: string, deviceId: string }} parts
 */
export function computeRepCommandHmac(apiKey, { commandId, executionId, command, deviceId }) {
  const payload = [COMMAND_HMAC_VERSION, commandId, executionId, command, deviceId].join('|');
  return createHmac('sha256', String(apiKey || '')).update(payload, 'utf8').digest('hex');
}

/**
 * @param {string} apiKey
 * @param {Record<string, unknown>} cmd
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function verifyRepCommandHmac(apiKey, cmd) {
  const commandId = String(cmd?.id || '').trim();
  const executionId = String(cmd?.execution_id || '').trim();
  const command = String(cmd?.command || '').trim();
  const deviceId = String(cmd?.device_id || process.env.REP_DEVICE_ID || '').trim();
  const signature = String(cmd?.command_hmac || '').trim();

  if (!signature) {
    if (/^(1|true|yes)$/i.test(String(process.env.REP_COMMAND_HMAC_OPTIONAL || '').trim())) {
      return { ok: true };
    }
    return { ok: false, message: 'Comando sem command_hmac — rejeitado (ative REP_COMMAND_HMAC_OPTIONAL=1 só em dev)' };
  }
  if (!commandId || !executionId || !command || !deviceId) {
    return { ok: false, message: 'Comando incompleto para validação HMAC' };
  }

  const expected = computeRepCommandHmac(apiKey, { commandId, executionId, command, deviceId });
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, message: 'command_hmac inválido — possível adulteração ou replay' };
    }
  } catch {
    return { ok: false, message: 'command_hmac malformado' };
  }
  return { ok: true };
}
