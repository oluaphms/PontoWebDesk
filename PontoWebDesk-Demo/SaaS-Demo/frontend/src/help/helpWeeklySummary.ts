import { getAverageMaturityScoreLastDays, getMaturityEvolutionSummary, getMaturityHistory } from './helpMaturityHistory';
import { getUnlockedAchievements } from './helpAchievements';

const WEEKLY_EVENTS_KEY = 'pontowebdesk:help_weekly_events';

interface WeeklyEvents {
  weekId: string;
  alertsResolved: number;
  tasksCompleted: number;
}

function weekIdFromDate(d = new Date()): string {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

function readEvents(): WeeklyEvents {
  if (typeof window === 'undefined') {
    return { weekId: weekIdFromDate(), alertsResolved: 0, tasksCompleted: 0 };
  }
  try {
    const raw = JSON.parse(window.localStorage.getItem(WEEKLY_EVENTS_KEY) || '{}') as WeeklyEvents;
    const current = weekIdFromDate();
    if (raw.weekId !== current) return { weekId: current, alertsResolved: 0, tasksCompleted: 0 };
    return raw;
  } catch {
    return { weekId: weekIdFromDate(), alertsResolved: 0, tasksCompleted: 0 };
  }
}

function writeEvents(ev: WeeklyEvents): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WEEKLY_EVENTS_KEY, JSON.stringify(ev));
}

export function recordWeeklyAlertResolved(): void {
  const ev = readEvents();
  writeEvents({ ...ev, alertsResolved: ev.alertsResolved + 1 });
}

export function recordWeeklyTaskCompleted(): void {
  const ev = readEvents();
  writeEvents({ ...ev, tasksCompleted: ev.tasksCompleted + 1 });
}

export interface WeeklySummary {
  weekLabel: string;
  averageScore: number | null;
  evolutionMessage: string | null;
  alertsResolved: number;
  tasksCompleted: number;
  achievementsUnlocked: number;
  headline: string;
}

export function buildWeeklySummary(currentScore: number): WeeklySummary {
  const avg = getAverageMaturityScoreLastDays(7);
  const evolution = getMaturityEvolutionSummary(7);
  const events = readEvents();
  const achievements = getUnlockedAchievements().length;
  const history = getMaturityHistory();

  let headline = 'Resumo da semana';
  if (currentScore >= 75) headline = 'Semana com operação estável';
  else if (currentScore < 50) headline = 'Semana com pendências relevantes';

  return {
    weekLabel: events.weekId,
    averageScore: avg,
    evolutionMessage: evolution?.message ?? null,
    alertsResolved: events.alertsResolved,
    tasksCompleted: events.tasksCompleted,
    achievementsUnlocked: achievements,
    headline,
  };
}
