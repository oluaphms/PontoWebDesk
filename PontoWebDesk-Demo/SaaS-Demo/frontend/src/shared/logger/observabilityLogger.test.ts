import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogPayload } from './logger';
import { redactForLogs } from './logger.redaction';
import { apiGet } from '../../services/api';

const REQUIRED_SCHEMA_FIELDS = [
  'timestamp',
  'level',
  'service',
  'module',
  'action',
  'requestId',
  'correlationId',
  'userId',
  'companyId',
  'message',
  'error',
  'meta',
];

describe('observability logger contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('gera payload com schema obrigatório', () => {
    const payload = createLogPayload('info', {
      module: 'observability.test',
      action: 'SCHEMA_CHECK',
      message: 'schema ok',
      requestId: 'req-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      companyId: 'company-1',
      meta: { ok: true },
    });

    for (const field of REQUIRED_SCHEMA_FIELDS) {
      expect(payload).toHaveProperty(field);
    }
    expect(payload.requestId).toBe('req-1');
    expect(payload.correlationId).toBe('corr-1');
  });

  it('mascara segredos, tokens, PII, base64 e binários', () => {
    const redacted = redactForLogs({
      password: 'senha-real',
      authorization: 'Bearer secret-token-123',
      jwt: 'aaa.bbb.ccc',
      email: 'pessoa@example.com',
      cpf: '12345678900',
      contentBase64: 'a'.repeat(300),
      buffer: new Uint8Array([1, 2, 3]),
      nested: { apiKey: 'key-real' },
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('senha-real');
    expect(serialized).not.toContain('secret-token-123');
    expect(serialized).not.toContain('pessoa@example.com');
    expect(serialized).not.toContain('12345678900');
    expect(serialized).not.toContain('key-real');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[REDACTED_BINARY_PAYLOAD]');
  });

  it('serializa erros sem vazar segredos', () => {
    const error = new Error('falha com Bearer token-super-secreto');
    const payload = createLogPayload('error', {
      module: 'observability.test',
      action: 'ERROR_SERIALIZATION',
      message: 'erro serializado',
      requestId: 'req-err',
      correlationId: 'corr-err',
      error,
    });

    const serialized = JSON.stringify(payload.error);
    expect(serialized).toContain('Error');
    expect(serialized).not.toContain('token-super-secreto');
    expect(serialized).toContain('[REDACTED_BEARER_TOKEN]');
  });

  it('propaga correlationId em chamadas API e captura headers de resposta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'x-correlation-id' ? 'corr-from-server' : null) },
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiGet('/health');
    await apiGet('/health/db');

    const firstHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(firstHeaders['x-correlation-id']).toBeTruthy();
    expect(secondHeaders['x-correlation-id']).toBe('corr-from-server');
  });
});
