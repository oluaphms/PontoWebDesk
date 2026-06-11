import React from 'react';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import type { RepCollectCommandSnapshot } from '../../../services/repCollectDiagnostics.service';

type RepCollectDiagnosticsSectionProps = {
  snapshot: RepCollectCommandSnapshot | null;
  loading?: boolean;
};

function yesNo(v: boolean | undefined | null, yes = 'Sim', no = 'Não'): string {
  if (v === true) return yes;
  if (v === false) return no;
  return '—';
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case 'done':
      return 'Concluído';
    case 'processing':
      return 'Executando…';
    case 'pending':
      return 'Aguardando agente…';
    case 'error':
      return 'Erro';
    case 'cancelled':
      return 'Cancelado';
    default:
      return status || '—';
  }
}

export const RepCollectDiagnosticsSection: React.FC<RepCollectDiagnosticsSectionProps> = ({
  snapshot,
  loading,
}) => {
  const cmd = snapshot?.command;
  const d = snapshot?.diagnostics ?? {};
  const result = snapshot?.result ?? {};
  const lastError =
    (typeof result.message === 'string' && result.message) ||
    (d.login_error && String(d.login_error)) ||
    (d.migration_error ? 'Erro de migração rep_ingest_punch no servidor' : null);

  return (
    <section className={repPageUi.c015} aria-labelledby="rep-hub-collect-diag">
      <p id="rep-hub-collect-diag" className={repPageUi.c016}>
        Diagnóstico da última coleta
      </p>
      {loading && !snapshot ? (
        <p className={repPageUi.c021}>Carregando…</p>
      ) : !cmd ? (
        <p className={repPageUi.c021}>Nenhuma coleta registrada para este relógio.</p>
      ) : (
        <ul className="text-sm space-y-1 text-slate-700 dark:text-slate-300">
          <li>
            <strong>Último comando:</strong> {cmd.id.slice(0, 8)}… · {statusLabel(cmd.status)}
          </li>
          <li>
            <strong>Login relógio:</strong>{' '}
            {d.login_ok === true ? 'OK' : d.login_ok === false ? `Falha (${d.login_error || '—'})` : '—'}
          </li>
          <li>
            <strong>AFD baixado:</strong> {yesNo(d.afd_downloaded)}
            {d.afd_downloaded && d.afd_lines != null ? ` · ${d.afd_lines} linhas` : ''}
          </li>
          <li>
            <strong>Batidas válidas (parse):</strong> {d.afd_valid ?? '—'}
          </li>
          <li>
            <strong>No escopo (datas):</strong> {d.afd_in_scope ?? result.parsed ?? '—'}
          </li>
          <li>
            <strong>Enfileiradas (agente):</strong> {d.queued ?? result.sent_ok ?? '—'}
          </li>
          {(d.duplicates ?? 0) > 0 ? (
            <li>
              <strong>Duplicadas (já tratadas):</strong> {d.duplicates}
              {d.dup_local != null || d.dup_server != null
                ? ` (cache ${d.dup_local ?? 0}, fila ${d.dup_server ?? 0})`
                : ''}
            </li>
          ) : null}
          {(d.pre_skipped ?? 0) > 0 ? (
            <li>
              <strong>Filtradas (lastNSR):</strong> {d.pre_skipped}
            </li>
          ) : null}
          <li>
            <strong>Enviadas à API:</strong> {d.uploaded ?? '—'}
          </li>
          <li>
            <strong>Fila local restante:</strong> {d.pending_left ?? '—'}
          </li>
          {lastError && cmd.status === 'error' ? (
            <li className="text-red-600 dark:text-red-400">
              <strong>Último erro:</strong> {lastError}
            </li>
          ) : null}
          {typeof result.message === 'string' && cmd.status === 'done' ? (
            <li className="text-emerald-700 dark:text-emerald-400">{result.message}</li>
          ) : null}
        </ul>
      )}
    </section>
  );
};
