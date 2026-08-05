import React, { memo } from 'react';
import type { CommercialJourney } from '../../api/companiesApi';
import type { MasterCompanyRow } from '../../types/company';
import { DetailField } from './DetailField';

type Props = {
  row: MasterCompanyRow;
  journey: CommercialJourney | null;
};

/** Painel técnico de provisionamento — só apresentação. */
export const TechnicalProvisionPanel = memo(function TechnicalProvisionPanel({
  row,
  journey,
}: Props) {
  const companyOk = Boolean(journey?.operationalCompanyId || row.id);
  const tenantOk = Boolean(journey?.tenantId || row.id);
  const adminOk = Boolean(journey?.adminUserId);
  const licenseOk = Boolean(journey?.licenseId);
  const inviteStatus =
    journey?.firstAccessStatus === 'accepted' || journey?.firstLoginAt
      ? 'Usuário ativo'
      : journey?.firstAccessStatus === 'sent' || journey?.inviteSentAt
        ? 'Enviado'
        : journey?.firstAccessStatus === 'failed'
          ? journey.firstAccessLastError?.toLowerCase().includes('sandbox')
            ? 'Não enviado (Sandbox)'
            : 'Não enviado'
          : 'Pendente';

  const showSandboxWarning =
    Boolean(journey?.firstAccessLastError) &&
    journey?.firstAccessStatus !== 'sent' &&
    journey?.firstAccessStatus !== 'accepted' &&
    !journey?.firstLoginAt;

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5 space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-600 dark:text-indigo-400">
          Provisionamento técnico
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
          Empresa operacional
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailField label="Empresa operacional" value={companyOk ? 'Criada' : 'Pendente'} />
        <DetailField label="Tenant" value={tenantOk ? 'Criado' : 'Pendente'} />
        <DetailField label="Administrador" value={adminOk ? 'Criado' : 'Pendente'} />
        <DetailField label="Licença" value={licenseOk ? 'Criada' : 'Pendente'} />
        <DetailField label="Workspace" value={row.dominio || 'Informação indisponível'} />
        <DetailField label="Integrações" value="Informação indisponível" />
        <DetailField
          label="Provisionamento"
          value={journey?.state ? String(journey.state) : 'Informação indisponível'}
        />
        <DetailField label="Convite" value={inviteStatus} />
        <DetailField
          label="Status"
          value={
            journey?.wizard?.implantationStatus ||
            (journey?.state === 'completed' ? 'Concluído' : 'Em andamento')
          }
        />
      </div>
      {showSandboxWarning ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{journey?.firstAccessLastError}</p>
      ) : null}
    </section>
  );
});
