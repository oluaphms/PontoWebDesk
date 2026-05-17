/**
 * Catálogo da Central de Ajuda — espelha /docs/operacional/*.md
 */

export const HELP_DOC_SLUGS = [
  'colaboradores',
  'departamentos',
  'cargos',
  'estruturas',
  'espelho-de-ponto',
  'calculos',
  'jornada',
  'auditoria-jornada',
  'escalas',
  'horarios',
  'banco-de-horas',
  'ausencias',
  'solicitacoes',
  'justificativas',
  'monitoramento',
  'relatorios',
  'pre-folha',
  'relogios-rep',
  'importar-afd',
  'fiscalizacao-rep-p',
  'seguranca-antifraude',
  'backup-dados',
  'empresa',
  'configuracoes',
  'ajuda',
] as const;

export type HelpDocSlug = (typeof HELP_DOC_SLUGS)[number];

export interface HelpNavItem {
  slug: HelpDocSlug;
  label: string;
}

export interface HelpNavGroup {
  id: string;
  label: string;
  items: HelpNavItem[];
}

export const HELP_NAV_GROUPS: HelpNavGroup[] = [
  {
    id: 'people',
    label: 'Pessoas',
    items: [
      { slug: 'colaboradores', label: 'Colaboradores' },
      { slug: 'departamentos', label: 'Departamentos' },
      { slug: 'cargos', label: 'Cargos' },
      { slug: 'estruturas', label: 'Estruturas' },
    ],
  },
  {
    id: 'time',
    label: 'Ponto',
    items: [
      { slug: 'espelho-de-ponto', label: 'Espelho de Ponto' },
      { slug: 'calculos', label: 'Cálculos' },
      { slug: 'jornada', label: 'Jornada' },
      { slug: 'auditoria-jornada', label: 'Auditoria' },
      { slug: 'escalas', label: 'Escalas' },
      { slug: 'horarios', label: 'Horários' },
    ],
  },
  {
    id: 'bank',
    label: 'Banco de Horas',
    items: [
      { slug: 'banco-de-horas', label: 'Banco de Horas' },
      { slug: 'ausencias', label: 'Ausências' },
      { slug: 'solicitacoes', label: 'Solicitações' },
      { slug: 'justificativas', label: 'Justificativas' },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoramento',
    items: [{ slug: 'monitoramento', label: 'Monitoramento em tempo real' }],
  },
  {
    id: 'reports',
    label: 'Relatórios',
    items: [{ slug: 'relatorios', label: 'Relatórios gerais' }],
  },
  {
    id: 'payroll',
    label: 'Pré-Folha',
    items: [{ slug: 'pre-folha', label: 'Pré-Folha (Jornada)' }],
  },
  {
    id: 'rep',
    label: 'REP',
    items: [
      { slug: 'relogios-rep', label: 'Relógios REP' },
      { slug: 'importar-afd', label: 'Importar AFD' },
      { slug: 'fiscalizacao-rep-p', label: 'Fiscalização REP-P' },
    ],
  },
  {
    id: 'security',
    label: 'Segurança',
    items: [{ slug: 'seguranca-antifraude', label: 'Segurança e Antifraude' }],
  },
  {
    id: 'data',
    label: 'Dados',
    items: [{ slug: 'backup-dados', label: 'Backup dos dados' }],
  },
  {
    id: 'company',
    label: 'Empresa',
    items: [{ slug: 'empresa', label: 'Empresa' }],
  },
  {
    id: 'settings',
    label: 'Configurações',
    items: [{ slug: 'configuracoes', label: 'Configurações gerais' }],
  },
  {
    id: 'help',
    label: 'Ajuda',
    items: [{ slug: 'ajuda', label: 'Ajuda / Suporte' }],
  },
];

export const HELP_DOC_LABELS: Record<HelpDocSlug, string> = HELP_NAV_GROUPS.flatMap((g) => g.items).reduce(
  (acc, item) => {
    acc[item.slug] = item.label;
    return acc;
  },
  {} as Record<HelpDocSlug, string>,
);

export const DEFAULT_HELP_DOC: HelpDocSlug = 'colaboradores';

/** Rotas admin → slug de documentação contextual */
export const HELP_ROUTE_TO_DOC: Record<string, HelpDocSlug> = {
  '/admin/employees': 'colaboradores',
  '/admin/import-employees': 'colaboradores',
  '/admin/departments': 'departamentos',
  '/admin/job-titles': 'cargos',
  '/admin/estruturas': 'estruturas',
  '/admin/timesheet': 'espelho-de-ponto',
  '/admin/calculos': 'calculos',
  '/admin/time-attendance': 'jornada',
  '/admin/time-attendance-audit': 'auditoria-jornada',
  '/admin/schedules': 'escalas',
  '/admin/shifts': 'horarios',
  '/admin/colaborador-jornada': 'jornada',
  '/admin/bank-hours': 'banco-de-horas',
  '/admin/absences': 'ausencias',
  '/admin/requests': 'solicitacoes',
  '/admin/justificativas': 'justificativas',
  '/admin/monitoring': 'monitoramento',
  '/admin/live-attendance': 'monitoramento',
  '/admin/reports': 'relatorios',
  '/admin/pre-folha': 'pre-folha',
  '/admin/rep-devices': 'relogios-rep',
  '/admin/import-rep': 'importar-afd',
  '/admin/fiscalizacao': 'fiscalizacao-rep-p',
  '/admin/security': 'seguranca-antifraude',
  '/admin/backup': 'backup-dados',
  '/admin/company': 'empresa',
  '/admin/settings': 'configuracoes',
  '/admin/ajuda': 'ajuda',
  '/admin/inteligencia-operacional': 'ajuda',
};

export function isHelpDocSlug(value: string | null | undefined): value is HelpDocSlug {
  return !!value && (HELP_DOC_SLUGS as readonly string[]).includes(value);
}

export function resolveHelpDocFromPath(pathname: string): HelpDocSlug | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (HELP_ROUTE_TO_DOC[normalized]) return HELP_ROUTE_TO_DOC[normalized];
  const match = Object.entries(HELP_ROUTE_TO_DOC).find(([route]) => normalized.startsWith(`${route}/`));
  return match ? match[1] : null;
}

export function getAllHelpNavItems(): HelpNavItem[] {
  return HELP_NAV_GROUPS.flatMap((g) => g.items);
}
