import type { HelpDocSlug } from './helpCenterCatalog';

export type HelpErrorCode =
  | 'PERIOD_CLOSED'
  | 'REP_PENDING'
  | 'TASK_CONFLICT'
  | 'TIMESHEET_INCONSISTENT'
  | 'IMPORT_BLOCKED'
  | 'MANUAL_PUNCH_BLOCKED';

export interface HelpErrorEntry {
  doc: HelpDocSlug;
  /** Alias resolvido para id de heading no markdown (ex: erros-comuns → 7-erros-comuns) */
  section: string;
  label?: string;
}

export const HELP_ERROR_MAP: Record<HelpErrorCode, HelpErrorEntry> = {
  PERIOD_CLOSED: {
    doc: 'espelho-de-ponto',
    section: 'erros-comuns',
    label: 'Período fechado',
  },
  REP_PENDING: {
    doc: 'relogios-rep',
    section: 'como-funciona',
    label: 'Batidas REP pendentes',
  },
  TASK_CONFLICT: {
    doc: 'monitoramento',
    section: 'erros-comuns',
    label: 'Conflito de tarefas',
  },
  TIMESHEET_INCONSISTENT: {
    doc: 'auditoria-jornada',
    section: 'erros-comuns',
    label: 'Inconsistência na jornada',
  },
  IMPORT_BLOCKED: {
    doc: 'importar-afd',
    section: 'erros-comuns',
    label: 'Importação bloqueada',
  },
  MANUAL_PUNCH_BLOCKED: {
    doc: 'colaboradores',
    section: 'erros-comuns',
    label: 'Ponto manual bloqueado',
  },
};

const MESSAGE_PATTERNS: { pattern: RegExp; code: HelpErrorCode }[] = [
  { pattern: /per[ií]odo fechado/i, code: 'PERIOD_CLOSED' },
  { pattern: /reabra oficialmente/i, code: 'PERIOD_CLOSED' },
  { pattern: /rep\s*\(?\s*pend/i, code: 'REP_PENDING' },
  { pattern: /batidas?\s+rep\s+pendente/i, code: 'REP_PENDING' },
  { pattern: /importa[cç][aã]o\s+rep\s+bloqueada/i, code: 'IMPORT_BLOCKED' },
  { pattern: /importa[cç][aã]o\s+bloqueada/i, code: 'IMPORT_BLOCKED' },
  { pattern: /inconsist[eê]ncia/i, code: 'TIMESHEET_INCONSISTENT' },
  { pattern: /conflito/i, code: 'TASK_CONFLICT' },
  { pattern: /ponto manual/i, code: 'MANUAL_PUNCH_BLOCKED' },
];

export function detectHelpErrorCode(message: string): HelpErrorCode | null {
  const text = String(message ?? '');
  if (!text.trim()) return null;
  for (const { pattern, code } of MESSAGE_PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return null;
}
