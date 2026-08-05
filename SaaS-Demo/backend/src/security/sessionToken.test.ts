// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { isCookieSessionMarker, resolveAuthToken } from '../security/sessionToken.js';

describe('sessionToken', () => {
  it('identifica marcador de sessão por cookie', () => {
    expect(isCookieSessionMarker('__http_only_cookie_session__')).toBe(true);
    expect(isCookieSessionMarker('cookie')).toBe(true);
    expect(isCookieSessionMarker('eyJhbGciOiJIUzI1NiJ9')).toBe(false);
  });

  it('usa cookie quando Bearer é marcador', () => {
    expect(
      resolveAuthToken('__http_only_cookie_session__', 'real-jwt-token'),
    ).toBe('real-jwt-token');
  });

  it('prioriza Bearer JWT real', () => {
    expect(resolveAuthToken('real-jwt', 'cookie-jwt')).toBe('real-jwt');
  });
});
