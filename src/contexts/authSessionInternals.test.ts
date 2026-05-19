import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAuthLogoutGuardActive,
  readUserFromProfileStore,
  setAuthLogoutGuard,
  setSessionUserCache,
} from './authSessionInternals';

vi.mock('../services/supabaseClient', () => ({
  getUserProfileStorage: () => ({
    getItem: (key: string) => (key === 'current_user' ? localStorage.getItem(key) : null),
    setItem: (key: string, value: string) => localStorage.setItem(key, value),
    removeItem: (key: string) => localStorage.removeItem(key),
  }),
}));

describe('authSessionInternals logout guard', () => {
  beforeEach(() => {
    localStorage.clear();
    setSessionUserCache(null);
    setAuthLogoutGuard(false);
  });

  it('não lê perfil do storage com guard ativo', () => {
    localStorage.setItem(
      'current_user',
      JSON.stringify({
        id: '11111111-1111-1111-1111-111111111111',
        nome: 'Test',
        email: 'a@b.com',
        role: 'employee',
        companyId: '22222222-2222-2222-2222-222222222222',
      }),
    );
    setAuthLogoutGuard(true);
    expect(isAuthLogoutGuardActive()).toBe(true);
    expect(readUserFromProfileStore()).toBeNull();
  });
});
