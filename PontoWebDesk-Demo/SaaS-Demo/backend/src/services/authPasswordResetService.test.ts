// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePasswordResetRedirectUrl } from './authPasswordResetService.js';

describe('resolvePasswordResetRedirectUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignora Origin não autorizado em produção', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FRONTEND_URL', '');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VITE_APP_URL', '');
    vi.stubEnv('CORS_APP_ORIGIN', '');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://app.example.com');

    expect(resolvePasswordResetRedirectUrl('https://evil.example')).toBe(
      'https://pontowebdesk.vercel.app/reset-password',
    );
    expect(resolvePasswordResetRedirectUrl('https://app.example.com')).toBe(
      'https://app.example.com/reset-password',
    );
  });

  it('prioriza URL configurada no servidor', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FRONTEND_URL', 'https://ponto.example.com/');

    expect(resolvePasswordResetRedirectUrl('https://evil.example')).toBe(
      'https://ponto.example.com/reset-password',
    );
  });
});
