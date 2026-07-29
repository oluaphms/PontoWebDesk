// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSecureCorsHeaders } from './security.js';

describe('security CORS wildcard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('aceita somente subdomínio HTTPS com fronteira de domínio válida', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '*.example.com');

    const allowed = getSecureCorsHeaders(
      new Request('https://api.example.com/resource', {
        headers: { Origin: 'https://app.example.com' },
      }),
    );
    const suffixAttack = getSecureCorsHeaders(
      new Request('https://api.example.com/resource', {
        headers: { Origin: 'https://attackexample.com' },
      }),
    );
    const insecureTransport = getSecureCorsHeaders(
      new Request('https://api.example.com/resource', {
        headers: { Origin: 'http://app.example.com' },
      }),
    );

    expect(allowed['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(suffixAttack['Access-Control-Allow-Origin']).toBeUndefined();
    expect(insecureTransport['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
