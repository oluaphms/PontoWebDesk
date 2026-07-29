import React, { memo } from 'react';
import { MasterCompanyCrmPanel } from '../MasterCompanyCrmPanel';

type Props = {
  tenantId: string;
  seedName: string;
  seedContact: string;
  seedEmail: string;
  seedPlan: string;
};

/**
 * Wrapper presentacional do CRM existente — sem alterar regras.
 * Nota: MasterCompanyCrmPanel legado ainda faz fetch próprio (fora do escopo desta pasta).
 */
export const CRMPanel = memo(function CRMPanel(props: Props) {
  return (
    <section id="crm" className="space-y-3 scroll-mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        CRM Comercial
      </h3>
      <MasterCompanyCrmPanel
        tenantId={props.tenantId}
        seedName={props.seedName}
        seedContact={props.seedContact}
        seedEmail={props.seedEmail}
        seedPlan={props.seedPlan}
      />
    </section>
  );
});
