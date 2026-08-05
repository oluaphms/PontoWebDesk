import { describe, expect, it } from 'vitest';
import { normalizeAuthenticatedSession } from './authSessionNormalizer';

const baseUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
};

describe('normalizeAuthenticatedSession', () => {
  it('aceita sessão válida com user no payload', () => {
    const result = normalizeAuthenticatedSession({
      session: { access_token: 'tok', user: baseUser },
      user: baseUser,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authUser.id).toBe(baseUser.id);
      expect(result.accessToken).toBe('tok');
    }
  });

  it('usa user embutido na sessão quando user vem null', () => {
    const result = normalizeAuthenticatedSession({
      session: { access_token: 'tok', user: baseUser },
      user: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.authUser.id).toBe(baseUser.id);
  });

  it('falha sem user', () => {
    const result = normalizeAuthenticatedSession({
      session: { access_token: 'tok' },
      user: null,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_user' });
  });

  it('falha sem sessão', () => {
    const result = normalizeAuthenticatedSession({
      session: null,
      user: baseUser,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_session' });
  });

  it('falha quando user da sessão difere do user do payload', () => {
    const result = normalizeAuthenticatedSession({
      session: {
        access_token: 'tok',
        user: { id: '22222222-2222-2222-2222-222222222222' },
      },
      user: baseUser,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('user_session_mismatch');
      expect(result.detail).toContain('22222222');
    }
  });
});
