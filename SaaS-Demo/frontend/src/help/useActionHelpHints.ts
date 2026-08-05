import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { resolveHelpDocFromPath, type HelpDocSlug } from './helpCenterCatalog';

export interface ActionHelpHint {
  message: string;
  doc: HelpDocSlug;
  section?: string;
}

const ROUTE_HINTS: Record<string, ActionHelpHint> = {
  '/admin/timesheet': {
    message: 'Você pode incluir batidas manuais e fechar o período quando tudo estiver conferido.',
    doc: 'espelho-de-ponto',
    section: 'como-usar',
  },
  '/admin/bank-hours': {
    message: 'Saldo negativo pode impactar a folha — confira a política de banco nas configurações.',
    doc: 'banco-de-horas',
    section: 'regras-importantes',
  },
  '/admin/time-attendance-audit': {
    message: 'Zere as pendências aqui antes de fechar o espelho do mês.',
    doc: 'auditoria-jornada',
    section: 'como-usar',
  },
  '/admin/rep-devices': {
    message: 'Sincronize o relógio diariamente para evitar batidas REP pendentes.',
    doc: 'relogios-rep',
    section: 'boas-praticas',
  },
  '/admin/import-rep': {
    message: 'Período fechado bloqueia importação — reabra o espelho se precisar corrigir.',
    doc: 'importar-afd',
    section: 'erros-comuns',
  },
  '/admin/pre-folha': {
    message: 'Calcule após fechar o espelho para números alinhados com a folha externa.',
    doc: 'pre-folha',
    section: 'como-usar',
  },
  '/admin/employees': {
    message: 'PIS e escala corretos evitam erro na importação do REP.',
    doc: 'colaboradores',
    section: 'boas-praticas',
  },
  '/admin/calculos': {
    message: 'Use para análise — o fechamento oficial é no Espelho de Ponto.',
    doc: 'calculos',
    section: 'regras-importantes',
  },
};

export function useActionHelpHints(): ActionHelpHint | null {
  const { pathname } = useLocation();

  return useMemo(() => {
    const normalized = pathname.replace(/\/+$/, '') || '/';
    if (ROUTE_HINTS[normalized]) return ROUTE_HINTS[normalized];

    const doc = resolveHelpDocFromPath(normalized);
    if (!doc) return null;

    const match = Object.entries(ROUTE_HINTS).find(([route]) => normalized.startsWith(route));
    return match ? match[1] : null;
  }, [pathname]);
}
