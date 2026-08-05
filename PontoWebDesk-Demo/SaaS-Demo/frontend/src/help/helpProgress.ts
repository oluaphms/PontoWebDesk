import type { HelpDocSlug } from './helpCenterCatalog';

const PROGRESS_KEY = 'pontowebdesk:help_progress';
const FAVORITES_KEY = 'pontowebdesk:help_favorites';
const ONBOARDING_KEY = 'pontowebdesk:help_onboarding_done';
const ONBOARDING_STEP_KEY = 'pontowebdesk:help_onboarding_step';

export type HelpProgressMap = Partial<Record<HelpDocSlug, string[]>>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function getHelpProgress(): HelpProgressMap {
  return readJson<HelpProgressMap>(PROGRESS_KEY, {});
}

export function markHelpSectionRead(slug: HelpDocSlug, sectionId: string): void {
  const map = getHelpProgress();
  const list = new Set(map[slug] ?? []);
  list.add(sectionId);
  writeJson(PROGRESS_KEY, { ...map, [slug]: Array.from(list) });
}

export function getHelpFavorites(): HelpDocSlug[] {
  return readJson<HelpDocSlug[]>(FAVORITES_KEY, []);
}

export function toggleHelpFavorite(slug: HelpDocSlug): boolean {
  const list = getHelpFavorites();
  const has = list.includes(slug);
  const next = has ? list.filter((s) => s !== slug) : [...list, slug];
  writeJson(FAVORITES_KEY, next);
  return !has;
}

export function isHelpFavorite(slug: HelpDocSlug): boolean {
  return getHelpFavorites().includes(slug);
}

export function isOnboardingCompleted(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(ONBOARDING_KEY) === '1';
}

export function setOnboardingCompleted(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ONBOARDING_KEY, '1');
}

export function getOnboardingStep(): number {
  const n = readJson<number>(ONBOARDING_STEP_KEY, 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function setOnboardingStep(step: number): void {
  writeJson(ONBOARDING_STEP_KEY, step);
}
