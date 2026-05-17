import { TRAINING_MODULES, type TrainingModule } from './helpTrainingMode';
import type { HelpDocSlug } from './helpCenterCatalog';

const ADMIN_MODE_KEY = 'pontowebdesk:help_training_admin_enabled';
const REQUIRED_KEY = 'pontowebdesk:help_training_required_modules';
const USER_PROGRESS_PREFIX = 'pontowebdesk:help_training_user:';

export function isTrainingAdminModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ADMIN_MODE_KEY) === '1';
}

export function setTrainingAdminModeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ADMIN_MODE_KEY, enabled ? '1' : '0');
}

export function getRequiredTrainingModules(): HelpDocSlug[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(REQUIRED_KEY) || '[]') as string[];
    return raw.filter((s): s is HelpDocSlug => TRAINING_MODULES.some((m) => m.slug === s));
  } catch {
    return [];
  }
}

export function setRequiredTrainingModules(slugs: HelpDocSlug[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REQUIRED_KEY, JSON.stringify(slugs));
}

export function toggleRequiredTrainingModule(slug: HelpDocSlug): boolean {
  const list = getRequiredTrainingModules();
  const has = list.includes(slug);
  const next = has ? list.filter((s) => s !== slug) : [...list, slug];
  setRequiredTrainingModules(next);
  return !has;
}

export interface UserTrainingProgress {
  userId: string;
  userName: string;
  percent: number;
  missing: TrainingModule[];
}

/** Progresso local por usuário (extensível a API futura). */
export function getUserTrainingProgress(userId: string, userName: string): UserTrainingProgress {
  const required = getRequiredTrainingModules();
  const modules = required.length > 0 ? TRAINING_MODULES.filter((m) => required.includes(m.slug)) : TRAINING_MODULES;

  let doneMap: Partial<Record<HelpDocSlug, boolean>> = {};
  if (typeof window !== 'undefined') {
    try {
      doneMap = JSON.parse(window.localStorage.getItem(`${USER_PROGRESS_PREFIX}${userId}`) || '{}') as Partial<
        Record<HelpDocSlug, boolean>
      >;
    } catch {
      doneMap = {};
    }
  }

  const missing = modules.filter((m) => !doneMap[m.slug]);
  const done = modules.length - missing.length;
  const percent = modules.length === 0 ? 100 : Math.round((done / modules.length) * 100);

  return { userId, userName, percent, missing };
}

export function seedUserTrainingProgress(userId: string, doneSlugs: HelpDocSlug[]): void {
  if (typeof window === 'undefined') return;
  const map: Partial<Record<HelpDocSlug, boolean>> = {};
  for (const s of doneSlugs) map[s] = true;
  window.localStorage.setItem(`${USER_PROGRESS_PREFIX}${userId}`, JSON.stringify(map));
}
