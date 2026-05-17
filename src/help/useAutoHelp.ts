import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_HELP_DOC, resolveHelpDocFromPath, type HelpDocSlug } from './helpCenterCatalog';

export interface UseAutoHelpResult {
  /** Slug do manual relacionado à rota atual */
  docSlug: HelpDocSlug;
  /** Rota normalizada */
  route: string;
  /** Está na própria central de ajuda */
  isHelpRoute: boolean;
  /** Deve exibir chrome flutuante (admin, fora de /ajuda) */
  showAutoHelpChrome: boolean;
}

/**
 * Resolve documentação contextual a partir da rota atual.
 */
export function resolveAutoHelpDocSlug(route: string): HelpDocSlug {
  const normalized = route.replace(/\/+$/, '') || '/';
  if (normalized.startsWith('/admin/ajuda')) return DEFAULT_HELP_DOC;
  return resolveHelpDocFromPath(normalized) ?? DEFAULT_HELP_DOC;
}

export function useAutoHelp(routeOverride?: string): UseAutoHelpResult {
  const location = useLocation();
  const route = routeOverride ?? location.pathname;

  return useMemo(() => {
    const normalized = route.replace(/\/+$/, '') || '/';
    const isHelpRoute =
      normalized.startsWith('/admin/ajuda') || normalized.startsWith('/admin/inteligencia-operacional');
    const docSlug = resolveAutoHelpDocSlug(normalized);
    const showAutoHelpChrome = normalized.startsWith('/admin') && !isHelpRoute;

    return {
      docSlug,
      route: normalized,
      isHelpRoute,
      showAutoHelpChrome,
    };
  }, [route]);
}
