/**
 * Consolida timelines de jornada + automação sem duplicar eventos.
 * Somente apresentação — sem fetch, sem regras novas.
 */
import type { MasterTimelineItem } from '../MasterVisualTimeline';
import type { CommercialAutomation } from '../../api/companiesApi';
import type { IntelligentOnboardingView } from '../../ux/deriveIntelligentOnboarding';
import { formatDisplayDate } from './displayFormat';

function sortKey(at: string | null | undefined): number {
  if (!at) return 0;
  const t = Date.parse(at);
  if (Number.isFinite(t)) return t;
  // formatAt já pode ser pt-BR — tenta parse frouxo
  const t2 = Date.parse(String(at).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
  return Number.isFinite(t2) ? t2 : 0;
}

function dedupeKey(item: MasterTimelineItem): string {
  return `${item.title}|${item.at ?? ''}|${item.ok ?? 'x'}|${String(item.detail ?? '').slice(0, 80)}`;
}

export function buildUnifiedTimeline(input: {
  onboarding: IntelligentOnboardingView | null;
  automation: CommercialAutomation | null;
}): MasterTimelineItem[] {
  const items: MasterTimelineItem[] = [];

  if (input.onboarding?.timeline?.length) {
    items.push(...input.onboarding.timeline);
  }

  const autoEvents = input.automation?.state.timeline ?? [];
  for (let idx = 0; idx < autoEvents.length; idx += 1) {
    const ev = autoEvents[idx]!;
    items.push({
      id: `auto-${ev.at}-${ev.step}-${idx}`,
      title: ev.label,
      detail: ev.detail,
      at: formatDisplayDate(ev.at),
      ok: ev.ok,
      automatic: ev.automatic,
    });
  }

  const seen = new Set<string>();
  const unique: MasterTimelineItem[] = [];
  for (const item of items) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  // Mais recente → mais antiga
  unique.sort((a, b) => sortKey(b.at) - sortKey(a.at));
  return unique;
}
