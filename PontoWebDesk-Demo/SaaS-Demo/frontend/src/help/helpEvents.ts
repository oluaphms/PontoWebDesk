/** Eventos globais padronizados do ecossistema de ajuda / inteligência operacional. */

export const PW_HELP_OPENED = 'pw:help_opened';
export const PW_MATURITY_UPDATED = 'pw:maturity_updated';
export const PW_CHECKLIST_COMPLETED = 'pw:checklist_completed';
export const PW_ACHIEVEMENT_UNLOCKED = 'pw:achievement_unlocked';

/** Legado — mantido para compatibilidade. */
export const LEGACY_MATURITY_UPDATED = 'pontowebdesk:maturity-updated';

export function dispatchPwHelpOpened(detail?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PW_HELP_OPENED, { detail }));
}

export function dispatchPwMaturityUpdated(detail: { score: number }): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PW_MATURITY_UPDATED, { detail }));
  window.dispatchEvent(new CustomEvent(LEGACY_MATURITY_UPDATED, { detail }));
}

export function dispatchPwChecklistCompleted(detail?: { itemId?: string; percent?: number }): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PW_CHECKLIST_COMPLETED, { detail }));
}

export function dispatchPwAchievementUnlocked(detail: { ids: string[] }): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PW_ACHIEVEMENT_UNLOCKED, { detail }));
}

export function isHelpDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('pw_help_debug') === 'true';
}
