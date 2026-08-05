import React from 'react';
import { masterUi } from '../ui/masterUi';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

/** Badges alinhados ao DS operacional (ds-badge-*). */
const TONE: Record<Tone, string> = {
  neutral: masterUi.badge.neutral,
  success: masterUi.badge.success,
  warning: masterUi.badge.warning,
  danger: masterUi.badge.danger,
  info: masterUi.badge.info,
  violet: 'ds-badge border border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/35 dark:bg-violet-500/15 dark:text-violet-300',
};

const STATUS_DISPLAY: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  trial: 'Teste',
  suspended: 'Suspenso',
  blocked: 'Bloqueado',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  paid: 'Pago',
  pending: 'Pendente',
  processing: 'Processando',
  overdue: 'Vencido',
  completed: 'Concluído',
  failed: 'Falhou',
  error: 'Erro',
  current: 'Atual',
  // Vigência comercial (validity.displayStatus / licenseValidity.displayStatus)
  ativa: 'Ativa',
  agendada: 'Agendada',
  expirada: 'Expirada',
  bloqueada: 'Bloqueada',
};

function statusDisplay(status: string): string {
  const s = String(status || '').trim();
  if (!s) return '—';
  return STATUS_DISPLAY[s.toLowerCase()] ?? s;
}

function toneFromStatus(status: string): Tone {
  const s = status.toLowerCase();
  if (
    ['active', 'ativo', 'ativa', 'paid', 'pago', 'completed', 'conclu', 'ok', 'success', 'current'].some((k) =>
      s.includes(k),
    )
  ) {
    return 'success';
  }
  if (
    [
      'trial',
      'teste',
      'pending',
      'pendente',
      'processing',
      'processando',
      'negoci',
      'implant',
      'warn',
      'expir',
      'venc',
      'agend',
    ].some((k) => s.includes(k))
  ) {
    return 'warning';
  }
  if (
    ['block', 'bloque', 'cancel', 'fail', 'erro', 'error', 'churn', 'inadimpl', 'suspended', 'suspend'].some(
      (k) => s.includes(k),
    )
  ) {
    return 'danger';
  }
  if (['draft', 'rascunho', 'pix', 'manual'].some((k) => s.includes(k))) return 'info';
  if (['pro', 'enterprise', 'hybrid'].some((k) => s.includes(k))) return 'violet';
  return 'neutral';
}

export function MasterStatusBadge({
  status,
  tone,
  className = '',
}: {
  status: string;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? toneFromStatus(status);
  return (
    <span className={`${TONE[resolved]} ${className}`.trim()}>{statusDisplay(status)}</span>
  );
}
