import { fetchLatestRepDeviceCommand, type RepDeviceCommandRow } from './repDeviceCommands.service';

export type RepCollectDiagnosticsPayload = {
  login_ok?: boolean;
  login_error?: string | null;
  device_url?: string;
  device_ip?: string;
  afd_downloaded?: boolean;
  afd_bytes?: number | null;
  afd_lines?: number | null;
  afd_valid?: number | null;
  afd_invalid?: number | null;
  afd_in_scope?: number | null;
  queued?: number;
  duplicates?: number;
  dup_local?: number;
  dup_server?: number;
  pre_skipped?: number;
  uploaded?: number;
  upload_rejected?: number;
  upload_unresolved?: number;
  pending_left?: number;
  migration_error?: boolean;
  mode?: string | null;
};

export type RepCollectCommandSnapshot = {
  command: RepDeviceCommandRow;
  result: Record<string, unknown>;
  diagnostics: RepCollectDiagnosticsPayload;
};

function parseDiagnostics(result: Record<string, unknown> | null | undefined): RepCollectDiagnosticsPayload {
  const raw = result?.diagnostics;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as RepCollectDiagnosticsPayload;
}

export async function fetchLastCollectCommand(
  deviceId: string,
  accessToken: string,
  commandId?: string,
): Promise<RepCollectCommandSnapshot | null> {
  const row = await fetchLatestRepDeviceCommand(deviceId, accessToken, {
    commandId,
    command: commandId ? undefined : 'collect_punches',
  });
  if (!row || row.command !== 'collect_punches') return null;
  const result =
    row.result && typeof row.result === 'object' && !Array.isArray(row.result)
      ? (row.result as Record<string, unknown>)
      : {};
  return { command: row, result, diagnostics: parseDiagnostics(result) };
}

export function formatCollectDiagnosticsForLog(d: RepCollectDiagnosticsPayload): string[] {
  const lines: string[] = [];
  if (d.login_ok === true) lines.push('[REP LOGIN SUCCESS]');
  else if (d.login_ok === false) lines.push(`[REP LOGIN ERROR] ${d.login_error || 'falha'}`);
  if (d.afd_downloaded) {
    lines.push(
      `[REP AFD DOWNLOAD] linhas=${d.afd_lines ?? '—'} bytes=${d.afd_bytes ?? '—'}`,
    );
    lines.push(
      `[REP AFD PARSE] válidas=${d.afd_valid ?? '—'} inválidas=${d.afd_invalid ?? '—'} no escopo=${d.afd_in_scope ?? '—'}`,
    );
  } else if (d.mode === 'MANUAL_IMPORT_REQUIRED') {
    lines.push('[REP AFD DOWNLOAD] não disponível via HTTP');
  }
  if (typeof d.queued === 'number') lines.push(`[REP QUEUE SAVE] enfileiradas=${d.queued}`);
  if (typeof d.duplicates === 'number' && d.duplicates > 0) {
    lines.push(
      `[REP DUPLICATE] total=${d.duplicates}${d.dup_local != null ? ` cache=${d.dup_local}` : ''}${d.dup_server != null ? ` fila=${d.dup_server}` : ''}`,
    );
  }
  if (typeof d.pre_skipped === 'number' && d.pre_skipped > 0) {
    lines.push(`[REP NSR FILTER] ignoradas=${d.pre_skipped}`);
  }
  if (typeof d.uploaded === 'number') {
    lines.push(
      `[REP UPLOAD] enviadas=${d.uploaded}${d.upload_rejected ? ` rejeitadas=${d.upload_rejected}` : ''}`,
    );
  }
  if (d.migration_error) lines.push('[MIGRATION ERROR] rep_ingest_punch desatualizada no servidor');
  if (typeof d.pending_left === 'number' && d.pending_left > 0) {
    lines.push(`Fila local: ${d.pending_left} batida(s) ainda pendente(s) de upload`);
  }
  return lines;
}
