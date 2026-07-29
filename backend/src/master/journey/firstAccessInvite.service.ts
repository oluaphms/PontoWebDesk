import { createHash } from 'node:crypto';
import { logger } from '../../logger/logger.js';

export type FirstAccessInvitePayload = {
  companyName: string;
  adminName: string;
  adminEmail: string;
  temporaryPassword: string;
  appUrl: string;
};

export type SendFirstAccessInviteResult =
  | { ok: true; provider: 'resend'; messageId: string | null }
  | {
      ok: false;
      provider: 'resend' | 'none';
      /** Mensagem amigável para a interface. */
      error: string;
      code: string;
      /** Erro técnico completo (somente logs/auditoria). */
      technicalError?: string;
      responseCode?: number | null;
      responseBody?: unknown;
    };

const MSG_API_KEY = 'RESEND_API_KEY não configurada.';
const MSG_FROM_UNAUTHORIZED = 'O endereço de envio não é autorizado pelo Resend.';
const MSG_DOMAIN_UNVERIFIED = 'O domínio do remetente ainda não foi verificado no Resend.';
const MSG_SANDBOX =
  'O Resend está em modo Sandbox. O convite não foi enviado porque somente destinatários autorizados podem receber e-mails. Após verificar o domínio, utilize "Reenviar convite".';
const MSG_TIMEOUT = 'Não foi possível enviar o convite neste momento.';
const MSG_GENERIC = 'Não foi possível enviar o convite neste momento.';

/** Códigos de falha apenas do envio de convite (não invalidam provisionamento). */
const INVITE_DELIVERY_ERROR_CODES = new Set([
  'INVITE_PROVIDER_NOT_CONFIGURED',
  'INVITE_FROM_NOT_CONFIGURED',
  'INVITE_RESEND_SANDBOX',
  'INVITE_DOMAIN_UNVERIFIED',
  'INVITE_FROM_UNAUTHORIZED',
  'INVITE_API_KEY_INVALID',
  'INVITE_SEND_FAILED',
  'FIRST_ACCESS_SEND_FAILED',
]);

export function isInviteDeliveryErrorCode(code: string | null | undefined): boolean {
  return INVITE_DELIVERY_ERROR_CODES.has(String(code || '').trim());
}

function appUrl(): string {
  return resolveInviteAppUrl().appUrl;
}

/** Ordem de resolução da URL do convite (sem hardcode de localhost). */
const INVITE_APP_URL_ENV_KEYS = [
  'MASTER_FIRST_ACCESS_APP_URL',
  'APP_URL',
  'FRONTEND_URL',
  'VITE_APP_URL',
] as const;

export type InviteAppUrlResolution = {
  appUrl: string;
  sourceVariable: (typeof INVITE_APP_URL_ENV_KEYS)[number] | 'fallback_production';
};

/**
 * URL do sistema no e-mail de primeiro acesso.
 * Local: APP_URL / FRONTEND_URL (ex.: http://localhost:3010).
 * Produção: APP_URL no .env de produção (ex.: https://pontowebdesk.vercel.app).
 */
export function resolveInviteAppUrl(): InviteAppUrlResolution {
  for (const key of INVITE_APP_URL_ENV_KEYS) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return { appUrl: value.replace(/\/+$/, ''), sourceVariable: key };
    }
  }
  // Último recurso apenas se nenhuma env estiver configurada.
  return {
    appUrl: 'https://pontowebdesk.vercel.app',
    sourceVariable: 'fallback_production',
  };
}

function html(payload: FirstAccessInvitePayload): string {
  const safeCompany = payload.companyName || 'Sua empresa';
  const safeAdmin = payload.adminName || 'Administrador';
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
    <h2>Primeiro acesso ao PontoWebDesk</h2>
    <p>Olá, ${safeAdmin}.</p>
    <p>A empresa <strong>${safeCompany}</strong> foi provisionada no Painel Master.</p>
    <p><strong>URL do sistema:</strong> <a href="${payload.appUrl}">${payload.appUrl}</a></p>
    <p><strong>Usuário:</strong> ${payload.adminEmail}<br/>
       <strong>Senha provisória:</strong> ${payload.temporaryPassword}</p>
    <p>Faça o primeiro login e altere a senha imediatamente.</p>
    <p>Por segurança, a senha provisória deve ser utilizada apenas no primeiro acesso.</p>
  </div>`;
}

function text(payload: FirstAccessInvitePayload): string {
  return [
    'Primeiro acesso ao PontoWebDesk',
    '',
    `Empresa: ${payload.companyName}`,
    `Usuário administrador: ${payload.adminEmail}`,
    `Senha provisória: ${payload.temporaryPassword}`,
    `Link do sistema: ${payload.appUrl}`,
    '',
    'Após o primeiro login, altere a senha obrigatoriamente.',
  ].join('\n');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function buildInviteToken(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 18)}`;
}

/** Remetente do convite — nomes aceitos no projeto (sem hardcode). */
const INVITE_FROM_ENV_KEYS = [
  'MASTER_INVITE_FROM',
  'RESEND_FROM',
  'APP_SENDER_EMAIL',
  'EMAIL_FROM',
] as const;

export type InviteFromResolution = {
  from: string;
  sourceVariable: (typeof INVITE_FROM_ENV_KEYS)[number] | null;
};

/** Resolve remetente + variável vencedora (auditoria / diagnóstico). */
export function resolveInviteFromAddress(): InviteFromResolution {
  for (const key of INVITE_FROM_ENV_KEYS) {
    const value = String(process.env[key] || '').trim();
    if (value) return { from: value, sourceVariable: key };
  }
  return { from: '', sourceVariable: null };
}

/**
 * Classifica erros técnicos do Resend em mensagem amigável para a UI.
 * Ordem: sandbox/testing → domínio → remetente → API key → timeout → genérico.
 */
export function classifyResendInviteError(
  technical: string,
  httpStatus?: number,
): { code: string; userMessage: string } {
  const t = String(technical || '').toLowerCase();

  if (
    t.includes('only send testing emails') ||
    t.includes('testing emails to your own') ||
    t.includes('sandbox')
  ) {
    return { code: 'INVITE_RESEND_SANDBOX', userMessage: MSG_SANDBOX };
  }

  if (
    (t.includes('domain') &&
      (t.includes('not verified') ||
        t.includes('unverified') ||
        t.includes('verify a domain') ||
        t.includes('verify your domain'))) ||
    t.includes('domain is not verified')
  ) {
    return { code: 'INVITE_DOMAIN_UNVERIFIED', userMessage: MSG_DOMAIN_UNVERIFIED };
  }

  if (
    t.includes('from address') ||
    t.includes('invalid from') ||
    (t.includes('sender') &&
      (t.includes('not allowed') || t.includes('unauthorized') || t.includes('invalid'))) ||
    t.includes('not authorized to send') ||
    (t.includes('from') && t.includes('not allowed'))
  ) {
    return { code: 'INVITE_FROM_UNAUTHORIZED', userMessage: MSG_FROM_UNAUTHORIZED };
  }

  if (
    httpStatus === 401 ||
    t.includes('api key') ||
    t.includes('invalid api_key') ||
    t.includes('missing api key') ||
    (t.includes('unauthorized') && t.includes('bearer'))
  ) {
    return { code: 'INVITE_API_KEY_INVALID', userMessage: MSG_API_KEY };
  }

  if (
    t.includes('timeout') ||
    t.includes('etimedout') ||
    t.includes('econnreset') ||
    t.includes('abort') ||
    t.includes('network')
  ) {
    return { code: 'INVITE_SEND_FAILED', userMessage: MSG_TIMEOUT };
  }

  return { code: 'INVITE_SEND_FAILED', userMessage: MSG_GENERIC };
}

function failInvite(
  provider: 'resend' | 'none',
  code: string,
  userMessage: string,
  technicalError?: string,
  extras?: { responseCode?: number | null; responseBody?: unknown },
): SendFirstAccessInviteResult {
  const technical = String(technicalError || userMessage).trim();
  logger.warn({
    module: 'master.invite',
    action: 'FIRST_ACCESS_INVITE_FAILED',
    message: 'Falha no envio do convite inicial (detalhe técnico preservado no log)',
    meta: {
      code,
      provider,
      userMessage,
      technicalError: technical,
      responseCode: extras?.responseCode ?? null,
      responseBody: extras?.responseBody ?? null,
    },
  });
  return {
    ok: false,
    provider,
    code,
    error: userMessage,
    technicalError: technical,
    responseCode: extras?.responseCode ?? null,
    responseBody: extras?.responseBody ?? null,
  };
}

export async function sendFirstAccessInvite(
  payload: Omit<FirstAccessInvitePayload, 'appUrl'>,
): Promise<SendFirstAccessInviteResult> {
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!resendApiKey) {
    return failInvite(
      'none',
      'INVITE_PROVIDER_NOT_CONFIGURED',
      MSG_API_KEY,
      'RESEND_API_KEY ausente no processo',
    );
  }
  const fromResolution = resolveInviteFromAddress();
  const from = fromResolution.from;
  if (!from) {
    return failInvite(
      'resend',
      'INVITE_FROM_NOT_CONFIGURED',
      MSG_FROM_UNAUTHORIZED,
      'MASTER_INVITE_FROM/RESEND_FROM/EMAIL_FROM ausente no processo',
    );
  }
  const base = appUrl();
  const body = {
    from,
    to: [payload.adminEmail],
    subject: `Primeiro acesso - ${payload.companyName}`,
    html: html({ ...payload, appUrl: base }),
    text: text({ ...payload, appUrl: base }),
  };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const raw = (await response.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string; name?: string };
      message?: string;
      name?: string;
    };
    if (!response.ok) {
      const technical =
        raw.error?.message || raw.message || raw.error?.name || raw.name || `HTTP ${response.status}`;
      const classified = classifyResendInviteError(technical, response.status);
      return failInvite('resend', classified.code, classified.userMessage, technical, {
        responseCode: response.status,
        responseBody: raw,
      });
    }
    return {
      ok: true,
      provider: 'resend',
      messageId: raw.id ?? null,
    };
  } catch (error) {
    const technical = error instanceof Error ? error.message : String(error);
    const classified = classifyResendInviteError(technical);
    return failInvite('resend', classified.code, classified.userMessage, technical);
  }
}
