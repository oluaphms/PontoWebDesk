const HISTORY_KEY = 'pontowebdesk:help_maturity_history';
const MAX_DAYS = 90;

export interface MaturityHistoryEntry {
  date: string;
  score: number;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readHistory(): MaturityHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]') as MaturityHistoryEntry[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: MaturityHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(sorted.slice(-MAX_DAYS)));
}

/** Registra ou atualiza o score do dia (sem alterar engine de maturidade). */
export function recordDailyMaturityScore(score: number): void {
  const today = todayKey();
  const history = readHistory();
  const idx = history.findIndex((e) => e.date === today);
  const entry: MaturityHistoryEntry = { date: today, score: Math.round(score) };
  if (idx >= 0) history[idx] = entry;
  else history.push(entry);
  writeHistory(history);
}

export function getMaturityHistory(): MaturityHistoryEntry[] {
  return readHistory();
}

export function getInitialMaturityScore(): number | null {
  const h = readHistory();
  return h.length > 0 ? h[0].score : null;
}

export function getMaturityHistoryLastDays(days: number): MaturityHistoryEntry[] {
  const h = readHistory();
  if (h.length <= days) return h;
  return h.slice(-days);
}

export interface MaturityEvolutionSummary {
  fromScore: number;
  toScore: number;
  days: number;
  delta: number;
  message: string;
}

export function getMaturityEvolutionSummary(windowDays = 7): MaturityEvolutionSummary | null {
  const h = getMaturityHistoryLastDays(windowDays);
  if (h.length < 2) return null;

  const fromScore = h[0].score;
  const toScore = h[h.length - 1].score;
  const days = Math.max(
    1,
    Math.round(
      (new Date(h[h.length - 1].date).getTime() - new Date(h[0].date).getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
  const delta = toScore - fromScore;
  const message = `Você evoluiu de ${fromScore}% → ${toScore}% em ${days} dia(s)`;

  return { fromScore, toScore, days, delta, message };
}

export function getAverageMaturityScoreLastDays(days: number): number | null {
  const slice = getMaturityHistoryLastDays(days);
  if (slice.length === 0) return null;
  const sum = slice.reduce((s, e) => s + e.score, 0);
  return Math.round(sum / slice.length);
}
