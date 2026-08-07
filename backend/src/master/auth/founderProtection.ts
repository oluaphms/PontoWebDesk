/**
 * Proteção permanente da conta Founder do SaaS (Painel Master).
 * Regra baseada apenas em `isFounder` — nunca e-mail/nome.
 */

import { MasterError } from '../errors.js';

export const FOUNDER_DENIAL_ACTIONS = [
  'FOUNDER_DELETE_DENIED',
  'FOUNDER_DISABLE_DENIED',
  'FOUNDER_ROLE_CHANGE_DENIED',
  'FOUNDER_BLOCK_DENIED',
] as const;

export type FounderDenialAction = (typeof FOUNDER_DENIAL_ACTIONS)[number];

export class MasterFounderProtectedError extends MasterError {
  readonly action: FounderDenialAction;
  readonly reason: string;
  readonly result = 'denied' as const;

  constructor(action: FounderDenialAction, reason: string) {
    super('MASTER_FORBIDDEN', reason);
    this.name = 'MasterFounderProtectedError';
    this.action = action;
    this.reason = reason;
  }
}

export type FounderTargetSnapshot = {
  id: string;
  isFounder: boolean;
  role: string;
  active: boolean;
};

export type FounderActorSnapshot = {
  id?: string | null;
  isFounder: boolean;
};

export type FounderMutationPatch = {
  name?: string;
  role?: string;
  active?: boolean;
  isFounder?: boolean;
  delete?: boolean;
  resetPassword?: boolean;
};

/**
 * Valida mutações sobre conta Founder.
 * Dados permitidos (nome/senha): somente outro Founder (ou o próprio Founder).
 * Destrutivas (bloquear/desativar/rebaixar/excluir/remover flag): sempre negadas.
 */
export function assertFounderMutationAllowed(
  actor: FounderActorSnapshot,
  target: FounderTargetSnapshot,
  patch: FounderMutationPatch,
): void {
  if (!target.isFounder) return;

  if (patch.delete) {
    throw new MasterFounderProtectedError(
      'FOUNDER_DELETE_DENIED',
      'A conta Founder não pode ser excluída.',
    );
  }

  if (patch.isFounder === false) {
    throw new MasterFounderProtectedError(
      'FOUNDER_ROLE_CHANGE_DENIED',
      'A conta Founder não pode perder o atributo Founder.',
    );
  }

  if (patch.role !== undefined && patch.role !== target.role) {
    throw new MasterFounderProtectedError(
      'FOUNDER_ROLE_CHANGE_DENIED',
      'A conta Founder não pode ser rebaixada ou ter o perfil alterado.',
    );
  }

  if (patch.active === false) {
    throw new MasterFounderProtectedError(
      'FOUNDER_BLOCK_DENIED',
      'A conta Founder não pode ser desativada ou bloqueada.',
    );
  }

  // Defesa: qualquer tentativa de manter Founder inativo.
  if (patch.active !== undefined && patch.active !== true && !target.active) {
    throw new MasterFounderProtectedError(
      'FOUNDER_DISABLE_DENIED',
      'A conta Founder não pode permanecer desativada.',
    );
  }

  const touchesAllowedFields =
    patch.name !== undefined || patch.resetPassword === true;
  const touchesRestricted =
    patch.role !== undefined ||
    patch.active !== undefined ||
    patch.isFounder !== undefined;

  if (!touchesAllowedFields && !touchesRestricted) return;

  const isSelf = Boolean(actor.id && actor.id === target.id);
  if (!actor.isFounder && !isSelf) {
    // OWNER comum (não Founder) não altera conta Founder (nome/senha/etc.).
    throw new MasterFounderProtectedError(
      'FOUNDER_ROLE_CHANGE_DENIED',
      'Somente uma conta Founder pode alterar dados permitidos de outra conta Founder.',
    );
  }
}

/** Bootstrap: Founder (idealizador) só com env explícito — nunca assume slot 1. */
export function bootstrapSlotIsFounder(slotLabel: string): boolean {
  const label = String(slotLabel || '').trim().toUpperCase();
  if (label === 'MASTER_OWNER_1' || label === 'MASTER_OWNER') {
    const raw = String(process.env.MASTER_OWNER_1_IS_FOUNDER ?? 'false').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
  }
  if (label === 'MASTER_OWNER_2') {
    const raw = String(process.env.MASTER_OWNER_2_IS_FOUNDER ?? 'false').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
  }
  return false;
}

/** IDs permanentes configurados em MASTER_FOUNDER_USER_IDS (nunca e-mail). */
export function configuredFounderUserIds(): string[] {
  return String(process.env.MASTER_FOUNDER_USER_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
