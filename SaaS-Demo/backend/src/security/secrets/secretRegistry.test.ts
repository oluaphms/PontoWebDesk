// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SECRET_REGISTRY,
  validateSecret,
} from './secretRegistry.js';

describe('secretRegistry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('inventaria credenciais privilegiadas e REP', () => {
    const names = SECRET_REGISTRY.map((secret) => secret.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'JWT_SECRET',
        'MASTER_JWT_SECRET',
        'MASTER_API_KEY',
        'API_KEY',
        'REP_API_KEY',
        'CLOCK_AGENT_API_KEY',
        'REP_BRIDGE_TOKEN',
        'SUPABASE_SERVICE_ROLE_KEY',
        'DEVICE_CREDENTIALS_MASTER_KEY',
      ]),
    );
  });

  it('rejeita placeholder mesmo quando atende ao comprimento mínimo', () => {
    const definition = SECRET_REGISTRY.find(
      (secret) => secret.name === 'MASTER_JWT_SECRET',
    )!;
    vi.stubEnv(
      'MASTER_JWT_SECRET',
      'CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32',
    );

    expect(validateSecret(definition)).toMatchObject({
      configured: true,
      valid: false,
      issues: ['weak_default'],
    });
  });
});
