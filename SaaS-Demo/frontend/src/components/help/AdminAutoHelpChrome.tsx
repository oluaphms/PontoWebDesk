import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAutoHelp } from '../../help/useAutoHelp';
import { openHelp } from '../../help/openHelp';
import { trackHelpAnalytics } from '../../help/helpAnalytics';
import type { HelpErrorCode } from '../../help/helpErrorMap';
import { openHelpFromError } from '../../help/openHelp';

interface AdminAutoHelpChromeProps {
  enabled?: boolean;
}

/**
 * Atalhos e handlers globais de ajuda (F1, erros operacionais).
 * O botão "Precisa de ajuda?" fica no menu Smart do dock inferior.
 */
export const AdminAutoHelpChrome: React.FC<AdminAutoHelpChromeProps> = ({ enabled = true }) => {
  const navigate = useNavigate();
  const { docSlug, showAutoHelpChrome } = useAutoHelp();

  useEffect(() => {
    if (!enabled || !showAutoHelpChrome) return;

    const onHelpError = (e: Event) => {
      const code = (e as CustomEvent<{ code: HelpErrorCode }>).detail?.code;
      if (code) openHelpFromError(code, navigate);
    };

    window.addEventListener('pontowebdesk:help-error', onHelpError as EventListener);
    return () => window.removeEventListener('pontowebdesk:help-error', onHelpError as EventListener);
  }, [enabled, showAutoHelpChrome, navigate]);

  useEffect(() => {
    if (!enabled || !showAutoHelpChrome) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        openHelp(docSlug, navigate, { resolveSection: true });
        trackHelpAnalytics('keyboard_shortcut', { doc: docSlug });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docSlug, navigate, enabled, showAutoHelpChrome]);

  return null;
};
