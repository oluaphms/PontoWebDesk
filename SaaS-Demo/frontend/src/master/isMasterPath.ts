/** Rotas do Painel Master (isoladas do Sistema Operacional). */
export function isMasterPath(pathname?: string): boolean {
  const p =
    pathname ??
    (typeof window !== 'undefined' ? String(window.location.pathname || '') : '');
  return p === '/master' || p.startsWith('/master/');
}
