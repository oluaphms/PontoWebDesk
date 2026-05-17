import type { HelpDocSlug } from './helpCenterCatalog';

export interface DailyChecklistItem {
  id: string;
  label: string;
  route: string;
  doc?: HelpDocSlug;
  section?: string;
}

export const DAILY_CHECKLIST_ITEMS: DailyChecklistItem[] = [
  {
    id: 'audit-inconsistencies',
    label: 'Verificar inconsistências de jornada',
    route: '/admin/time-attendance-audit',
    doc: 'auditoria-jornada',
    section: 'como-usar',
  },
  {
    id: 'validate-today-punches',
    label: 'Validar batidas do dia',
    route: '/admin/timesheet',
    doc: 'espelho-de-ponto',
    section: 'como-usar',
  },
  {
    id: 'check-bank-hours',
    label: 'Checar banco de horas',
    route: '/admin/bank-hours',
    doc: 'banco-de-horas',
    section: 'regras-importantes',
  },
  {
    id: 'review-critical-alerts',
    label: 'Revisar alertas críticos',
    route: '/admin/dashboard',
    doc: 'auditoria-jornada',
    section: 'erros-comuns',
  },
  {
    id: 'sync-rep',
    label: 'Conferir sincronização REP',
    route: '/admin/rep-devices',
    doc: 'relogios-rep',
    section: 'boas-praticas',
  },
];

import { dispatchPwChecklistCompleted } from './helpEvents';

const STORAGE_KEY = 'pontowebdesk:help_daily_checklist';

interface DailyChecklistState {
  date: string;
  done: string[];
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readState(): DailyChecklistState {
  if (typeof window === 'undefined') return { date: todayKey(), done: [] };
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as DailyChecklistState;
    if (raw.date !== todayKey()) return { date: todayKey(), done: [] };
    return { date: raw.date, done: Array.isArray(raw.done) ? raw.done : [] };
  } catch {
    return { date: todayKey(), done: [] };
  }
}

function writeState(state: DailyChecklistState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getDailyChecklistDoneIds(): string[] {
  return readState().done;
}

export function isDailyChecklistItemDone(id: string): boolean {
  return readState().done.includes(id);
}

export function toggleDailyChecklistItem(id: string): boolean {
  const state = readState();
  const has = state.done.includes(id);
  const done = has ? state.done.filter((x) => x !== id) : [...state.done, id];
  writeState({ date: todayKey(), done });
  const marked = !has;
  if (marked) {
    const percent = Math.round((done.length / DAILY_CHECKLIST_ITEMS.length) * 100);
    dispatchPwChecklistCompleted({ itemId: id, percent });
  }
  return marked;
}

export function getDailyChecklistProgressPercent(): number {
  const total = DAILY_CHECKLIST_ITEMS.length;
  if (total === 0) return 100;
  const done = readState().done.length;
  return Math.round((done / total) * 100);
}

export function resetDailyChecklistIfNewDay(): void {
  readState();
}
