// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  computeRepCommandHmac,
  signRepCommandRow,
  verifyRepCommandHmac,
} from '../services/repCommandHmacService.js';

describe('repCommandHmacService', () => {
  const secret = 'device-bridge-token';
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    execution_id: '22222222-2222-4222-8222-222222222222',
    command: 'collect_punches',
    device_id: '33333333-3333-4333-8333-333333333333',
  };

  it('signRepCommandRow gera hex de 64 chars', () => {
    const sig = signRepCommandRow(secret, row);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifyRepCommandHmac aceita assinatura correta', () => {
    const sig = signRepCommandRow(secret, row);
    expect(
      verifyRepCommandHmac(
        secret,
        {
          commandId: row.id,
          executionId: String(row.execution_id),
          command: row.command,
          deviceId: row.device_id,
        },
        sig,
      ),
    ).toBe(true);
  });

  it('verifyRepCommandHmac rejeita assinatura errada', () => {
    expect(
      verifyRepCommandHmac(
        secret,
        {
          commandId: row.id,
          executionId: String(row.execution_id),
          command: row.command,
          deviceId: row.device_id,
        },
        'f'.repeat(64),
      ),
    ).toBe(false);
  });

  it('computeRepCommandHmac alinhado com agente', () => {
    const sig = computeRepCommandHmac(secret, {
      commandId: row.id,
      executionId: String(row.execution_id),
      command: row.command,
      deviceId: row.device_id,
    });
    expect(sig).toBe(signRepCommandRow(secret, row));
  });
});
