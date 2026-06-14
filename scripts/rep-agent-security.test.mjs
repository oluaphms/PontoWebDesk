// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  computeContentHmac,
  deriveIntegrityKey,
  INTEGRITY_ALG,
} from './rep-agent-security.mjs';
import { redact } from './rep-agent-logger.mjs';
import { resolveSecretField } from './rep-agent-secrets.mjs';

describe('rep-agent-security', () => {
  it('deriveIntegrityKey é determinístico', () => {
    const a = deriveIntegrityKey('key-a');
    const b = deriveIntegrityKey('key-a');
    expect(a.equals(b)).toBe(true);
  });

  it('computeContentHmac muda com conteúdo', () => {
    const key = 'api-key-test';
    const h1 = computeContentHmac('{"a":1}', key);
    const h2 = computeContentHmac('{"a":2}', key);
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('INTEGRITY_ALG definido', () => {
    expect(INTEGRITY_ALG).toBe('hmac-sha256-v1');
  });
});

describe('rep-agent-logger redact', () => {
  it('redige api_key e password', () => {
    const out = redact({ api_key: 'secret-key', password: 'p@ss', ok: true });
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.ok).toBe(true);
  });

  it('redige Bearer em string', () => {
    const out = redact('Authorization: Bearer abc.def.ghi');
    expect(out).toContain('[REDACTED_BEARER_TOKEN]');
  });
});

describe('rep-agent-secrets resolveSecretField', () => {
  it('permite texto puro com REP_ALLOW_PLAIN_SECRETS', () => {
    const prev = process.env.REP_ALLOW_PLAIN_SECRETS;
    process.env.REP_ALLOW_PLAIN_SECRETS = '1';
    try {
      const v = resolveSecretField({ api_key: 'plain-key' }, 'api_key', { packaged: true });
      expect(v).toBe('plain-key');
    } finally {
      if (prev === undefined) delete process.env.REP_ALLOW_PLAIN_SECRETS;
      else process.env.REP_ALLOW_PLAIN_SECRETS = prev;
    }
  });

  it('rejeita texto puro em produção empacotada sem flag (Windows)', () => {
    if (process.platform !== 'win32') return;
    const prev = process.env.REP_ALLOW_PLAIN_SECRETS;
    delete process.env.REP_ALLOW_PLAIN_SECRETS;
    try {
      expect(() => resolveSecretField({ api_key: 'plain-key' }, 'api_key', { packaged: true })).toThrow(
        /texto puro/,
      );
    } finally {
      if (prev !== undefined) process.env.REP_ALLOW_PLAIN_SECRETS = prev;
    }
  });
});
