import React from 'react';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import type { RepDiagnosisSnapshot } from '../../../services/repDiagnostics.service';

type RepDiagnosticsSectionProps = {
  diagnosis: RepDiagnosisSnapshot | null;
  loading: boolean;
  clientLoadUsersOk: boolean | null;
  clientLoadUsersError: string | null;
  clientLoginOk: boolean | null;
  clientConsolidationOk: boolean | null;
};

function statusLine(ok: boolean | null | undefined, okLabel = 'OK', failLabel = 'Falhou', unknownLabel = '—'): string {
  if (ok === true) return `✅ ${okLabel}`;
  if (ok === false) return `❌ ${failLabel}`;
  return `⚪ ${unknownLabel}`;
}

export const RepDiagnosticsSection: React.FC<RepDiagnosticsSectionProps> = ({
  diagnosis,
  loading,
  clientLoadUsersOk,
  clientLoadUsersError,
  clientLoginOk,
  clientConsolidationOk,
}) => {
  const loadUsersOk =
    clientLoadUsersOk !== null
      ? clientLoadUsersOk
      : diagnosis?.load_users.ok ?? null;
  const loadUsersDetail =
    clientLoadUsersError ||
    (loadUsersOk === false ? 'Erro boolean / HTTP 400' : diagnosis?.load_users.note);

  return (
    <section className={repPageUi.c015} aria-labelledby="rep-hub-diagnostics">
      <p id="rep-hub-diagnostics" className={repPageUi.c016}>
        Diagnóstico
      </p>
      {loading && <p className={repPageUi.c040}>Atualizando diagnóstico…</p>}
      <div className={repPageUi.c054}>
        <p className={repPageUi.c022}>
          RPC: {statusLine(diagnosis?.rpc.ok, 'OK', 'Bloqueada ou ausente')}
          {diagnosis && !diagnosis.rpc.exists_in_db ? ' (função ausente no banco)' : ''}
        </p>
        <p className={repPageUi.c022}>
          Control iD: {statusLine(diagnosis?.controlid.ok, 'OK', 'Erro', 'Aguardando teste')}
        </p>
        <p className={repPageUi.c022}>
          Login: {statusLine(clientLoginOk ?? diagnosis?.login.ok, 'OK', 'Falhou', 'Não testado')}
        </p>
        <p className={repPageUi.c022}>
          load_users.fcgi:{' '}
          {statusLine(
            loadUsersOk,
            'OK',
            loadUsersDetail?.includes('boolean') ? 'Erro boolean' : 'Erro',
            'Não testado',
          )}
        </p>
        {loadUsersDetail && loadUsersOk === false ? (
          <p className={repPageUi.c014}>{loadUsersDetail}</p>
        ) : null}
        <p className={repPageUi.c022}>
          Última coleta:{' '}
          {statusLine(diagnosis?.last_collect.ok, 'OK', 'Sem coleta recente', '—')}
          {diagnosis?.last_collect.at ? ` (${new Date(diagnosis.last_collect.at).toLocaleString('pt-BR')})` : ''}
        </p>
        <p className={repPageUi.c022}>
          Última consolidação:{' '}
          {statusLine(
            clientConsolidationOk ?? (diagnosis?.last_consolidation.failed ? false : diagnosis?.last_consolidation.ok),
            'OK',
            diagnosis?.last_consolidation.error?.message?.includes('rpc_not_allowed')
              ? 'rpc_not_allowed'
              : 'Falhou',
            '—',
          )}
        </p>
      </div>
    </section>
  );
};
