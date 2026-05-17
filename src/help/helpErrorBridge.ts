import type { HelpErrorCode } from './helpErrorMap';
import { detectHelpErrorCode } from './helpErrorMap';

/** Dispara evento global para chrome de ajuda reagir a erros conhecidos. */
export function emitHelpError(code: HelpErrorCode): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pontowebdesk:help-error', { detail: { code } }));
}

/** Detecta código a partir da mensagem e emite evento (se houver match). */
export function emitHelpErrorFromMessage(message: string): HelpErrorCode | null {
  const code = detectHelpErrorCode(message);
  if (code) emitHelpError(code);
  return code;
}
