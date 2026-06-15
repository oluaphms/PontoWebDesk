import { describe, expect, it } from 'vitest';
import { shouldInvalidateAuthSession } from './authMe.service';

describe('shouldInvalidateAuthSession', () => {
  it('invalida em 401 com códigos definitivos', () => {
    expect(shouldInvalidateAuthSession(401, 'AUTH_TOKEN_EXPIRED')).toBe(true);
    expect(shouldInvalidateAuthSession(401, 'AUTH_TENANT_CHANGED')).toBe(true);
    expect(shouldInvalidateAuthSession(401, 'AUTH_USER_NOT_FOUND')).toBe(true);
  });

  it('não invalida em erro de rede ou 500', () => {
    expect(shouldInvalidateAuthSession(undefined, '')).toBe(false);
    expect(shouldInvalidateAuthSession(500, 'AUTH_ME_FAILED')).toBe(false);
    expect(shouldInvalidateAuthSession(503, 'AUTH_NOT_CONFIGURED')).toBe(false);
  });

  it('não invalida em 401 sem código reconhecido (transiente/proxy)', () => {
    expect(shouldInvalidateAuthSession(401, '')).toBe(false);
    expect(shouldInvalidateAuthSession(401, 'UNKNOWN')).toBe(false);
  });
});
