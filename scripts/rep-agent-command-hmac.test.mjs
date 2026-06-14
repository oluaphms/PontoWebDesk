// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  computeRepCommandHmac,
  verifyRepCommandHmac,
  COMMAND_HMAC_VERSION,
} from './rep-agent-command-hmac.mjs';

describe('rep-agent-command-hmac', () => {
  const apiKey = 'test-device-key-abc';
  const cmd = {
    id: 'cmd-uuid-1',
    execution_id: 'exec-uuid-2',
    command: 'test_connection',
    device_id: 'dev-uuid-3',
  };

  it('computa HMAC determinístico', () => {
    const a = computeRepCommandHmac(apiKey, {
      commandId: cmd.id,
      executionId: cmd.execution_id,
      command: cmd.command,
      deviceId: cmd.device_id,
    });
    const b = computeRepCommandHmac(apiKey, {
      commandId: cmd.id,
      executionId: cmd.execution_id,
      command: cmd.command,
      deviceId: cmd.device_id,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejeita HMAC adulterado', () => {
    const sig = computeRepCommandHmac(apiKey, {
      commandId: cmd.id,
      executionId: cmd.execution_id,
      command: cmd.command,
      deviceId: cmd.device_id,
    });
    const bad = { ...cmd, command_hmac: sig.replace(/^./, 'f') };
    const r = verifyRepCommandHmac(apiKey, bad);
    expect(r.ok).toBe(false);
  });

  it('aceita HMAC válido', () => {
    const sig = computeRepCommandHmac(apiKey, {
      commandId: cmd.id,
      executionId: cmd.execution_id,
      command: cmd.command,
      deviceId: cmd.device_id,
    });
    const r = verifyRepCommandHmac(apiKey, { ...cmd, command_hmac: sig });
    expect(r.ok).toBe(true);
  });

  it('usa versão v1 no payload', () => {
    expect(COMMAND_HMAC_VERSION).toBe('v1');
  });
});
