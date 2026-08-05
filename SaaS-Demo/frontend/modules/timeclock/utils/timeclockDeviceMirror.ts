import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepDevice } from '../../rep-integration/types';
import type { TimeClockProviderKey } from '../interfaces/TimeClockProvider';
import { resolveTimeClockProviderKey } from './dataAdapters';

/** Linha `rep_devices` com colunas opcionais de credencial na tabela. */
export type RepDeviceRowForMirror = RepDevice & {
  usuario?: string | null;
  senha?: string | null;
};

const FALLBACK_HUB_TYPE: TimeClockProviderKey = 'control_id';

/**
 * Monta payload para `timeclock_devices` espelhando `rep_devices`
 * (um registro por `rep_device_id`, upsert pelo cliente).
 */
export function repRowToTimeclockMirrorPayload(row: RepDeviceRowForMirror): Record<string, unknown> {
  const hubType = resolveTimeClockProviderKey(row) ?? FALLBACK_HUB_TYPE;
  const ex =
    row.config_extra && typeof row.config_extra === 'object'
      ? ({ ...row.config_extra } as Record<string, unknown>)
      : {};
  const username =
    (typeof row.usuario === 'string' && row.usuario.trim() !== '' ? row.usuario.trim() : null) ??
    (typeof ex.rep_login === 'string' && ex.rep_login.trim() !== '' ? String(ex.rep_login).trim() : null);
  const password =
    (typeof row.senha === 'string' && row.senha !== '' ? row.senha : null) ??
    (typeof ex.rep_password === 'string' && ex.rep_password !== '' ? String(ex.rep_password) : null);

  const config_json = {
    fabricante: row.fabricante ?? null,
    modelo: row.modelo ?? null,
    tipo_conexao: row.tipo_conexao ?? null,
    provider_type: row.provider_type ?? null,
    config_extra: Object.keys(ex).length ? ex : {},
  };

  return {
    rep_device_id: row.id,
    company_id: row.company_id,
    type: hubType,
    ip: row.ip ?? null,
    port: row.porta ?? null,
    username,
    password,
    config_json,
    nome_dispositivo: row.nome_dispositivo,
    ativo: row.ativo !== false,
    updated_at: new Date().toISOString(),
  };
}

/** Cria ou atualiza o espelho em `timeclock_devices` para o `rep_devices` informado. */
export async function upsertTimeClockDeviceMirror(
  supabase: SupabaseClient,
  row: RepDeviceRowForMirror
): Promise<void> {
  const payload = repRowToTimeclockMirrorPayload(row);
  const { error } = await supabase.from('timeclock_devices').upsert(payload, {
    onConflict: 'rep_device_id',
  });
  if (error) {
    throw new Error(`timeclock_devices: ${error.message}`);
  }
}
