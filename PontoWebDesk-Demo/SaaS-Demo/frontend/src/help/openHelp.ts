import type { NavigateFunction } from 'react-router-dom';
import { isHelpDocSlug, resolveHelpDocFromPath, type HelpDocSlug } from './helpCenterCatalog';
import { HELP_ERROR_MAP, type HelpErrorCode } from './helpErrorMap';
import { resolveHelpSectionId } from './helpSectionResolve';
import { trackHelpAnalytics } from './helpAnalytics';
import { trackBehaviorDoc } from './helpBehaviorTracker';
import { logHelpRoi } from './helpRoi';
import { dispatchPwHelpOpened } from './helpEvents';

export interface OpenHelpOptions {
  section?: string;
  replace?: boolean;
  /** Resolve section alias antes de navegar */
  resolveSection?: boolean;
}

export function getHelpCenterPath(slug: string, options?: OpenHelpOptions): string {
  const params = new URLSearchParams();
  if (isHelpDocSlug(slug)) params.set('doc', slug);
  else params.set('doc', slug);
  if (options?.section) params.set('section', options.section);
  const qs = params.toString();
  return qs ? `/admin/ajuda?${qs}` : '/admin/ajuda';
}

/** Navega para a central de ajuda com documento (e seção opcional). */
export function openHelp(slug: string, navigate: NavigateFunction, options?: OpenHelpOptions): void {
  const run = (section?: string) => {
    navigate(getHelpCenterPath(slug, { ...options, section }), { replace: options?.replace ?? false });
    trackHelpAnalytics('doc_opened', { doc: slug, section });
    trackBehaviorDoc(slug);
    logHelpRoi('session_start');
    dispatchPwHelpOpened({ doc: slug, section });
  };

  if (options?.section && options.resolveSection !== false && isHelpDocSlug(slug)) {
    void resolveHelpSectionId(slug, options.section).then((id) => run(id));
    return;
  }
  run(options?.section);
}

/** Abre ajuda a partir de código de erro conhecido. */
export function openHelpFromError(code: HelpErrorCode, navigate: NavigateFunction): void {
  const entry = HELP_ERROR_MAP[code];
  if (!entry) return;
  trackHelpAnalytics('error_help_opened', { code, doc: entry.doc, section: entry.section });
  logHelpRoi('error_avoided');
  openHelp(entry.doc, navigate, { section: entry.section, resolveSection: true });
}

/** Resolve slug a partir da rota atual (para botão contextual automático). */
export function resolveContextualHelpSlug(pathname: string): HelpDocSlug | null {
  return resolveHelpDocFromPath(pathname);
}
