import { observabilityConsole } from '../shared/logger/observabilityConsole';
export type HelpAnalyticsEvent =
  | 'doc_opened'
  | 'search_used'
  | 'error_help_opened'
  | 'onboarding_step_viewed'
  | 'onboarding_completed'
  | 'favorite_added'
  | 'favorite_removed'
  | 'section_read'
  | 'auto_help_suggested'
  | 'auto_help_opened'
  | 'insight_clicked'
  | 'keyboard_shortcut';

export interface HelpAnalyticsPayload {
  event: HelpAnalyticsEvent;
  doc?: string;
  section?: string;
  query?: string;
  code?: string;
  step?: number;
  insightId?: string;
  [key: string]: string | number | boolean | undefined;
}

export function trackHelpAnalytics(event: HelpAnalyticsEvent, payload: Omit<HelpAnalyticsPayload, 'event'> = {}): void {
  const entry: HelpAnalyticsPayload = {
    event,
    ts: Date.now(),
    ...payload,
  };
  observabilityConsole.log('[HELP ANALYTICS]', entry);
}
