import { afterEach, describe, expect, it } from 'vitest';
import { clearCsrfToken, CSRF_COOKIE_NAME, getCsrfToken, setCsrfToken } from './csrfToken';

describe('csrfToken', () => {
  afterEach(() => {
    clearCsrfToken();
    document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; path=/`;
  });

  it('lê token da memória quando definido no login', () => {
    setCsrfToken('csrf-from-login');
    expect(getCsrfToken()).toBe('csrf-from-login');
  });

  it('recupera token do cookie pwd_csrf após reload (mobile)', () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-from-cookie; path=/`;
    expect(getCsrfToken()).toBe('csrf-from-cookie');
  });
});
