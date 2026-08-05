// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateAgentToken, hashAgentToken } from './agentToken.js';

describe('agentToken', () => {
  it('gera token com prefixo uag_ e entropia suficiente', () => {
    const token = generateAgentToken();
    expect(token.startsWith('uag_')).toBe(true);
    expect(token.length).toBeGreaterThan(40);
  });

  it('hash é estável e hexadecimal de 64 chars', () => {
    const token = 'uag_abc123';
    const a = hashAgentToken(token);
    const b = hashAgentToken(token);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('tokens diferentes produzem hashes diferentes', () => {
    expect(hashAgentToken(generateAgentToken())).not.toBe(hashAgentToken(generateAgentToken()));
  });
});
