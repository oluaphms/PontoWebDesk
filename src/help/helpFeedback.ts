import { trackHelpAnalytics } from './helpAnalytics';

const FEEDBACK_KEY = 'pontowebdesk:help_feedback_log';

export interface HelpFeedbackEntry {
  doc: string;
  helpful: boolean;
  context?: string;
  ts: number;
}

function readLog(): HelpFeedbackEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(FEEDBACK_KEY) || '[]') as HelpFeedbackEntry[];
  } catch {
    return [];
  }
}

function writeLog(entries: HelpFeedbackEntry[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = entries.slice(-200);
  window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(trimmed));
}

export function recordHelpFeedback(doc: string, helpful: boolean, context?: string): void {
  const entry: HelpFeedbackEntry = { doc, helpful, context, ts: Date.now() };
  writeLog([...readLog(), entry]);
  trackHelpAnalytics(helpful ? 'doc_opened' : 'search_used', {
    doc,
    query: helpful ? 'feedback_positive' : 'feedback_negative',
  });
  console.log('[HELP FEEDBACK]', entry);
}

export function getHelpFeedbackSummary(): { positive: number; negative: number } {
  const log = readLog();
  return {
    positive: log.filter((e) => e.helpful).length,
    negative: log.filter((e) => !e.helpful).length,
  };
}
