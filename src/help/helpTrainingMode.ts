import { HELP_DOC_SLUGS, HELP_DOC_LABELS, type HelpDocSlug } from './helpCenterCatalog';

const TRAINING_ENABLED_KEY = 'pontowebdesk:help_training_enabled';
const TRAINING_DONE_KEY = 'pontowebdesk:help_training_done';

export interface TrainingModule {
  slug: HelpDocSlug;
  label: string;
}

/** Módulos essenciais do treinamento RH */
export const TRAINING_MODULES: TrainingModule[] = [
  { slug: 'empresa', label: HELP_DOC_LABELS.empresa },
  { slug: 'colaboradores', label: HELP_DOC_LABELS.colaboradores },
  { slug: 'horarios', label: HELP_DOC_LABELS.horarios },
  { slug: 'escalas', label: HELP_DOC_LABELS.escalas },
  { slug: 'jornada', label: HELP_DOC_LABELS.jornada },
  { slug: 'relogios-rep', label: HELP_DOC_LABELS['relogios-rep'] },
  { slug: 'espelho-de-ponto', label: HELP_DOC_LABELS['espelho-de-ponto'] },
  { slug: 'banco-de-horas', label: HELP_DOC_LABELS['banco-de-horas'] },
  { slug: 'pre-folha', label: HELP_DOC_LABELS['pre-folha'] },
].filter((m) => (HELP_DOC_SLUGS as readonly string[]).includes(m.slug));

function readDone(): Partial<Record<HelpDocSlug, boolean>> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(TRAINING_DONE_KEY) || '{}') as Partial<
      Record<HelpDocSlug, boolean>
    >;
  } catch {
    return {};
  }
}

function writeDone(map: Partial<Record<HelpDocSlug, boolean>>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TRAINING_DONE_KEY, JSON.stringify(map));
}

export function isTrainingModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(TRAINING_ENABLED_KEY) === '1';
}

export function setTrainingModeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TRAINING_ENABLED_KEY, enabled ? '1' : '0');
}

export function markTrainingModuleDone(slug: HelpDocSlug, userId?: string): void {
  const map = readDone();
  map[slug] = true;
  writeDone(map);
  if (userId && typeof window !== 'undefined') {
    try {
      const key = `pontowebdesk:help_training_user:${userId}`;
      const userMap = JSON.parse(window.localStorage.getItem(key) || '{}') as Partial<Record<HelpDocSlug, boolean>>;
      userMap[slug] = true;
      window.localStorage.setItem(key, JSON.stringify(userMap));
    } catch {
      /* ignore */
    }
  }
}

export function isTrainingModuleDone(slug: HelpDocSlug): boolean {
  return !!readDone()[slug];
}

export function getTrainingProgressPercent(): number {
  const done = readDone();
  const total = TRAINING_MODULES.length;
  if (total === 0) return 0;
  const completed = TRAINING_MODULES.filter((m) => done[m.slug]).length;
  return Math.round((completed / total) * 100);
}

export function getTrainingModulesWithStatus(): (TrainingModule & { done: boolean })[] {
  const done = readDone();
  return TRAINING_MODULES.map((m) => ({ ...m, done: !!done[m.slug] }));
}
