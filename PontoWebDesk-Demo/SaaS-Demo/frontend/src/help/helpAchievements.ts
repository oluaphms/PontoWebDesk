import { isOnboardingCompleted } from './helpProgress';

const STORAGE_KEY = 'pontowebdesk:help_achievements';
const LAST_ALERTS_DAY_KEY = 'pontowebdesk:help_achievements_no_alerts_day';

export interface HelpAchievement {
  id: string;
  title: string;
  description: string;
  emoji: string;
}

export const HELP_ACHIEVEMENTS: HelpAchievement[] = [
  {
    id: 'first_fix',
    title: 'Primeira inconsistência resolvida',
    description: 'Você zerou pelo menos um alerta crítico ou inconsistência.',
    emoji: '🎯',
  },
  {
    id: 'no_alerts_day',
    title: 'Dia sem alertas',
    description: 'Nenhum alerta operacional em aberto ao final do dia.',
    emoji: '✨',
  },
  {
    id: 'full_onboarding',
    title: 'Onboarding completo',
    description: 'Todos os primeiros passos do sistema foram concluídos.',
    emoji: '🚀',
  },
  {
    id: 'high_maturity',
    title: 'Maturidade acima de 80%',
    description: 'Sua operação atingiu excelência operacional.',
    emoji: '🏆',
  },
  {
    id: 'score_improved_10',
    title: 'Evolução de 10 pontos',
    description: 'Score de maturidade subiu pelo menos 10 pontos.',
    emoji: '📈',
  },
];

function readUnlocked(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const arr = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeUnlocked(set: Set<string>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export function getUnlockedAchievements(): string[] {
  return [...readUnlocked()];
}

export function isAchievementUnlocked(id: string): boolean {
  return readUnlocked().has(id);
}

export interface AchievementCheckContext {
  score: number;
  openAlertsCount: number;
  previousOpenAlertsCount?: number;
  scoreImprovedFromInitial?: boolean;
}

/** Verifica e desbloqueia conquistas; retorna IDs recém-desbloqueadas. */
export function checkAndUnlockAchievements(ctx: AchievementCheckContext): string[] {
  const unlocked = readUnlocked();
  const newly: string[] = [];

  const tryUnlock = (id: string) => {
    if (unlocked.has(id)) return;
    unlocked.add(id);
    newly.push(id);
  };

  if (isOnboardingCompleted()) tryUnlock('full_onboarding');
  if (ctx.score >= 80) tryUnlock('high_maturity');

  const prevAlerts = ctx.previousOpenAlertsCount ?? 999;
  if (prevAlerts > 0 && ctx.openAlertsCount < prevAlerts) tryUnlock('first_fix');

  if (ctx.openAlertsCount === 0 && typeof window !== 'undefined') {
    const today = new Date().toISOString().slice(0, 10);
    const last = window.localStorage.getItem(LAST_ALERTS_DAY_KEY);
    if (last !== today) {
      window.localStorage.setItem(LAST_ALERTS_DAY_KEY, today);
      tryUnlock('no_alerts_day');
    }
  }

  if (ctx.scoreImprovedFromInitial) tryUnlock('score_improved_10');

  if (newly.length > 0) writeUnlocked(unlocked);
  return newly;
}

export function getAchievementsWithStatus(): (HelpAchievement & { unlocked: boolean })[] {
  const unlocked = readUnlocked();
  return HELP_ACHIEVEMENTS.map((a) => ({ ...a, unlocked: unlocked.has(a.id) }));
}
