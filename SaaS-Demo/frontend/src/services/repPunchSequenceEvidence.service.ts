import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Evidência de batidas REP no dia (para validação mobile quando time_records ainda não refletiu o relógio).
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { getLocalDateString, normalizePunchType } from './timeProcessingService';

export type RepPunchSequenceHit = {
  tipo: string;
  data_hora: string;
};

function mapRepTipoMarcacao(raw: string | null | undefined): string | null {
  const t = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!t) return null;
  if (t === 'E' || t === 'ENTRADA' || t === 'IN') return 'entrada';
  if (t === 'S' || t === 'SAIDA' || t === 'SAÍDA' || t === 'OUT') return 'saida';
  if (t === 'P' || t === 'PAUSA' || t === 'BREAK') return 'pausa';
  const norm = normalizePunchType(raw ?? '');
  if (norm === 'entrada' || norm === 'saida' || norm === 'pausa') return norm;
  return null;
}

/**
 * Batidas REP do colaborador no dia civil local (resolved_user_id ou time_record já ligado).
 */
export async function fetchRepPunchSequenceForDay(
  userId: string,
  companyId: string,
  dateStr: string,
): Promise<RepPunchSequenceHit[]> {
  if (!isSupabaseConfigured() || !userId || !companyId) return [];

  const client = getSupabaseClient();
  if (!client) return [];

  const start = `${dateStr}T00:00:00`;
  const end = `${dateStr}T23:59:59.999`;

  const { data, error } = await client
    .from('rep_punch_logs')
    .select('tipo_marcacao, data_hora, resolved_user_id, ignored')
    .eq('company_id', companyId)
    .eq('resolved_user_id', userId)
    .gte('data_hora', start)
    .lte('data_hora', end)
    .order('data_hora', { ascending: true });

  if (error) {
    observabilityConsole.warn('[repPunchSequenceEvidence] fetch:', error.message);
    return [];
  }

  const hits: RepPunchSequenceHit[] = [];
  for (const row of data ?? []) {
    if (row.ignored === true) continue;
    const resolved = String(row.resolved_user_id ?? '').trim();
    if (resolved && resolved !== userId) continue;
    const tipo = mapRepTipoMarcacao(row.tipo_marcacao);
    if (!tipo) continue;
    hits.push({ tipo, data_hora: String(row.data_hora) });
  }
  return hits;
}

/** Último tipo REP do dia (cronológico). */
export function lastRepPunchTypeForDay(hits: RepPunchSequenceHit[]): string | null {
  if (!hits.length) return null;
  return hits[hits.length - 1]!.tipo;
}

/** Há entrada REP no dia? */
export function repDayHasEntry(hits: RepPunchSequenceHit[]): boolean {
  return hits.some((h) => h.tipo === 'entrada');
}
