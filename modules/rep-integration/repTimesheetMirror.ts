/**
 * Após consolidar batidas REP (time_records), recalcula o dia no motor e verifica linha em timesheets_daily.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type RepPromotedDetailRow = {
  nsr?: number | null;
  user_id: string;
  data_hora: string;
  status?: string;
};

/**
 * Debounce por (user_id + date) para evitar recalcular o mesmo dia repetidamente
 * quando a consolidação do REP roda em batches ou retries.
 */
const RECALC_DEBOUNCE_MS = 30_000;
const lastAutoRecalcByKey = new Map<string, number>();

function civilDateSaoPauloFromIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

function parseDataHora(row: RepPromotedDetailRow): string | null {
  const raw = row.data_hora;
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  return String(raw);
}

/**
 * Para cada batida promovida: recalcula o dia civil (America/Sao_Paulo) e verifica `timesheets_daily`.
 */
export async function syncEspelhoAfterRepPromote(
  supabase: SupabaseClient,
  companyId: string,
  promotedDetail: readonly RepPromotedDetailRow[] | null | undefined
): Promise<void> {
  if (!promotedDetail?.length) return;

  const { recalculate_period } = await import('../../src/engine/timeEngine');

  type PairKey = string;
  const pairsToRecalc = new Map<PairKey, { user_id: string; civilDate: string }>();
  const rowsByKey = new Map<PairKey, RepPromotedDetailRow[]>();

  for (const row of promotedDetail) {
    const uid = String(row.user_id ?? '').trim();
    const iso = parseDataHora(row);
    if (!uid || !iso) {
      console.error('[TIMESHEET FAIL]', {
        motivo: 'promoted_detail sem user_id ou data_hora válidos',
        nsr: row.nsr ?? null,
        user_id: row.user_id ?? null,
        data_hora: row.data_hora,
      });
      continue;
    }
    const civilDate = civilDateSaoPauloFromIso(iso);
    if (!civilDate) {
      console.error('[TIMESHEET FAIL]', {
        motivo: 'data_hora não interpretável para dia civil (America/Sao_Paulo)',
        nsr: row.nsr ?? null,
        user_id: uid,
        data_hora: iso,
      });
      continue;
    }
    const key = `${uid}|${civilDate}`;
    if (!pairsToRecalc.has(key)) {
      pairsToRecalc.set(key, { user_id: uid, civilDate });
    }
    const list = rowsByKey.get(key) ?? [];
    list.push({ ...row, user_id: uid, data_hora: iso });
    rowsByKey.set(key, list);
  }

  const cid = companyId.trim();

  for (const { user_id, civilDate } of pairsToRecalc.values()) {
    const debounceKey = `${user_id}|${civilDate}`;
    const now = Date.now();
    const last = lastAutoRecalcByKey.get(debounceKey);
    if (last != null && now - last < RECALC_DEBOUNCE_MS) {
      continue;
    }
    lastAutoRecalcByKey.set(debounceKey, now);

    let calcErrMsg: string | null = null;
    try {
      await recalculate_period(user_id, cid, civilDate, civilDate);
      console.info('[TIMESHEET AUTO RECALC]', {
        user_id,
        date: civilDate,
        source: 'rep_promote',
      });
    } catch (e) {
      calcErrMsg = e instanceof Error ? e.message : String(e);
      console.error('[TIMESHEET FAIL]', {
        motivo: `recalculate_period: ${calcErrMsg}`,
        user_id,
        company_id: cid,
        date: civilDate,
      });
    }

    const { data: tsRow, error: tsErr } = await supabase
      .from('timesheets_daily')
      .select('id')
      .eq('employee_id', user_id)
      .eq('date', civilDate)
      .maybeSingle();

    const key = `${user_id}|${civilDate}`;
    const batch = rowsByKey.get(key) ?? [];
    const espelhoLinha = Boolean(tsRow?.id) && !tsErr;

    for (const pr of batch) {
      let status: string;
      if (calcErrMsg) status = 'motor_erro';
      else if (tsErr) status = `consulta_espelho_erro:${tsErr.message}`;
      else if (!tsRow?.id) {
        status =
          'espelho_ausente (recálculo não persistiu linha — possível folha fechada, protecção raw_data ou falha de integridade)';
      } else status = 'espelho_ok';

      console.info('[REP → TIMESHEET]', {
        nsr: pr.nsr ?? null,
        user_id: pr.user_id,
        status,
        date: civilDate,
      });
    }

    if (!calcErrMsg && !tsErr && !tsRow?.id) {
      console.error('[TIMESHEET FAIL]', {
        motivo:
          'Após recalculate_period, não há linha em timesheets_daily (comum: período fechado na RPC timesheet_is_closed_for_stamp, raw_data manual/fechado, ou falha silenciosa writeTimesheetsDailyCalculatedRow).',
        user_id,
        company_id: cid,
        date: civilDate,
        nsrs: batch.map((b) => b.nsr ?? null),
      });
    }
    if (tsErr) {
      console.error('[TIMESHEET FAIL]', {
        motivo: tsErr.message,
        code: (tsErr as { code?: string }).code,
        user_id,
        company_id: cid,
        date: civilDate,
      });
    }
  }
}
