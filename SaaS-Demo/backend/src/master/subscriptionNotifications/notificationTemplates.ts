import type { SubscriptionNotificationKind } from './subscriptionNotification.types.js';

function appBaseUrl(): string {
  const configured = (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.CORS_APP_ORIGIN ||
    'http://localhost:3010'
  )
    .toString()
    .trim()
    .replace(/\/+$/, '');
  return configured || 'http://localhost:3010';
}

/** URL para o admin da empresa regularizar após bloqueio. */
export function resolveRegularizeUrl(): string {
  return `${appBaseUrl()}/login?reason=commercial_blocked`;
}

export type NotificationTemplate = {
  title: string;
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
};

export function templateForKind(
  kind: SubscriptionNotificationKind,
  opts?: { companyName?: string | null },
): NotificationTemplate {
  const company = opts?.companyName?.trim() || 'Empresa';
  switch (kind) {
    case 'DUE_IN_7':
      return {
        title: 'Aviso de vencimento',
        message: 'Seu plano vencerá em 7 dias.',
        level: 'info',
      };
    case 'DUE_IN_3':
      return {
        title: 'Segundo aviso',
        message: 'Segundo aviso.',
        level: 'warn',
      };
    case 'DUE_TODAY':
      return {
        title: 'Pagamento pendente',
        message: 'Pagamento pendente.',
        level: 'warn',
      };
    case 'BLOCKED':
      return {
        title: 'Empresa bloqueada',
        message: `Empresa bloqueada.\nClique aqui para regularizar.\n${resolveRegularizeUrl()}`,
        level: 'error',
      };
    case 'PAID_RELEASED':
      return {
        title: 'Pagamento recebido',
        message: 'Pagamento recebido.\nSua empresa foi liberada automaticamente',
        level: 'success',
      };
    default: {
      const _exhaustive: never = kind;
      return {
        title: 'Notificação',
        message: String(_exhaustive),
        level: 'info',
      };
    }
  }
}

/** Mensagem curta para o inbox do Painel Master. */
export function masterInboxMessage(
  kind: SubscriptionNotificationKind,
  companyName: string,
): string {
  const tpl = templateForKind(kind, { companyName });
  return `${companyName}: ${tpl.message.replace(/\n/g, ' ')}`;
}
