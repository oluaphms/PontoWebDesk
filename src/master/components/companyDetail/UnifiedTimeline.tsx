import React, { memo } from 'react';
import { MasterVisualTimeline, type MasterTimelineItem } from '../MasterVisualTimeline';

type Props = {
  items: MasterTimelineItem[];
};

/** Uma única timeline cronológica (mais recente → mais antiga). */
export const UnifiedTimeline = memo(function UnifiedTimeline({ items }: Props) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
        Timeline unificada
      </p>
      <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
        Jornada · Automação · Onboarding
      </h3>
      <div className="mt-4">
        <MasterVisualTimeline
          items={items}
          empty="Nenhum evento ainda — confirme o pagamento ou avance o provisionamento."
        />
      </div>
    </section>
  );
});
