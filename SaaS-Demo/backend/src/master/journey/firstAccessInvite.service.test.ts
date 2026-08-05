// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyResendInviteError,
  resolveInviteAppUrl,
  resolveInviteFromAddress,
} from './firstAccessInvite.service.js';

describe('classifyResendInviteError', () => {
  it('classifica sandbox / testing emails', () => {
    const result = classifyResendInviteError(
      'You can only send testing emails to your own email address (agentesian8nautomacao@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains.',
    );
    expect(result.code).toBe('INVITE_RESEND_SANDBOX');
    expect(result.userMessage).toContain('modo Sandbox');
    expect(result.userMessage).toContain('Reenviar convite');
  });

  it('classifica domínio não verificado', () => {
    const result = classifyResendInviteError('The domain is not verified. Please verify your domain.');
    expect(result.code).toBe('INVITE_DOMAIN_UNVERIFIED');
    expect(result.userMessage).toBe('O domínio do remetente ainda não foi verificado no Resend.');
  });

  it('classifica remetente inválido', () => {
    const result = classifyResendInviteError('The from address is not allowed.');
    expect(result.code).toBe('INVITE_FROM_UNAUTHORIZED');
    expect(result.userMessage).toBe('O endereço de envio não é autorizado pelo Resend.');
  });

  it('classifica API key inválida', () => {
    const result = classifyResendInviteError('Invalid API key', 401);
    expect(result.code).toBe('INVITE_API_KEY_INVALID');
    expect(result.userMessage).toBe('RESEND_API_KEY não configurada.');
  });

  it('classifica timeout', () => {
    const result = classifyResendInviteError('fetch failed: ETIMEDOUT');
    expect(result.code).toBe('INVITE_SEND_FAILED');
    expect(result.userMessage).toBe('Não foi possível enviar o convite neste momento.');
  });
});

describe('resolveInviteFromAddress', () => {
  const keys = ['MASTER_INVITE_FROM', 'RESEND_FROM', 'APP_SENDER_EMAIL', 'EMAIL_FROM'] as const;
  const snapshot = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of keys) {
      const prev = snapshot[k];
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  });

  it('respeita prioridade MASTER_INVITE_FROM > RESEND_FROM > APP_SENDER_EMAIL > EMAIL_FROM', () => {
    for (const k of keys) delete process.env[k];
    process.env.EMAIL_FROM = 'onboarding@resend.dev';
    process.env.APP_SENDER_EMAIL = 'app@example.com';
    process.env.RESEND_FROM = 'resend@example.com';
    process.env.MASTER_INVITE_FROM = 'no-reply@phmsdev.com.br';
    expect(resolveInviteFromAddress()).toEqual({
      from: 'no-reply@phmsdev.com.br',
      sourceVariable: 'MASTER_INVITE_FROM',
    });
  });

  it('usa EMAIL_FROM quando as demais estão ausentes', () => {
    for (const k of keys) delete process.env[k];
    process.env.EMAIL_FROM = 'onboarding@resend.dev';
    expect(resolveInviteFromAddress()).toEqual({
      from: 'onboarding@resend.dev',
      sourceVariable: 'EMAIL_FROM',
    });
  });
});

describe('resolveInviteAppUrl', () => {
  const keys = [
    'MASTER_FIRST_ACCESS_APP_URL',
    'APP_URL',
    'FRONTEND_URL',
    'VITE_APP_URL',
  ] as const;
  const snapshot = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of keys) {
      const prev = snapshot[k];
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  });

  it('prioriza MASTER_FIRST_ACCESS_APP_URL > APP_URL > FRONTEND_URL > VITE_APP_URL', () => {
    for (const k of keys) delete process.env[k];
    process.env.VITE_APP_URL = 'https://vite.example';
    process.env.FRONTEND_URL = 'https://frontend.example';
    process.env.APP_URL = 'http://localhost:3010';
    process.env.MASTER_FIRST_ACCESS_APP_URL = 'https://invite.example';
    expect(resolveInviteAppUrl()).toEqual({
      appUrl: 'https://invite.example',
      sourceVariable: 'MASTER_FIRST_ACCESS_APP_URL',
    });
  });

  it('usa APP_URL quando as específicas estão ausentes', () => {
    for (const k of keys) delete process.env[k];
    process.env.APP_URL = 'http://localhost:3010/';
    expect(resolveInviteAppUrl()).toEqual({
      appUrl: 'http://localhost:3010',
      sourceVariable: 'APP_URL',
    });
  });
});
