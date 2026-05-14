/**
 * POST /api/process-daily-time
 * Job diário (ex.: cron 23:59) para processar o ponto do dia.
 * Header: X-Cron-Secret: <CRON_SECRET>
 * Variáveis: SUPABASE_URL, URL_SUPABASE ou VITE_SUPABASE_URL (ver `getSupabaseUrlForServer`), SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 */

import { messageFromUnknown } from '../src/utils/messageFromUnknown';
import { getSupabaseConfig } from './_shared/getSupabaseConfig.js';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cron-Secret',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

async function handler(request: Request): Promise<Response> {
  const route = '/api/process-daily-time';
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const secret = request.headers.get('X-Cron-Secret')?.trim();
  const cronSecret = (process.env.CRON_SECRET || process.env.VITE_CRON_SECRET || '').trim();
  if (cronSecret && secret !== cronSecret) {
    return Response.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let supabaseUrl: string;
  let serviceKey: string;
  try {
    ({ url: supabaseUrl, serviceKey } = getSupabaseConfig());
  } catch {
    return Response.json(
      { error: 'Supabase não configurado.', code: 'CONFIG_MISSING' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const monthStr = dateStr.slice(0, 7);

    const { data: users } = await sup.from('users').select('id, company_id, schedule_id').not('company_id', 'is', null);
    const list = users || [];
    let processed = 0;
    const errors: string[] = [];

    for (const u of list) {
      try {
        const { data: records } = await sup
          .from('time_records')
          .select('id, type, created_at')
          .eq('user_id', u.id)
          .gte('created_at', `${dateStr}T00:00:00`)
          .lte('created_at', `${dateStr}T23:59:59.999`)
          .order('created_at', { ascending: true });

        const dayRecords = records || [];
        let totalMs = 0;
        let lastIn: string | null = null;
        const types = { entrada: 'entrada', saida: 'saída', pausa: 'pausa' };
        for (const r of dayRecords) {
          const t = r.created_at;
          const type = (r.type || '').toLowerCase();
          if (type === 'entrada') {
            if (lastIn) totalMs += new Date(t).getTime() - new Date(lastIn).getTime();
            lastIn = t;
          } else if ((type === 'saída' || type === 'saida') && lastIn) {
            totalMs += new Date(t).getTime() - new Date(lastIn).getTime();
            lastIn = null;
          } else if (type === 'pausa' && lastIn) {
            totalMs += new Date(t).getTime() - new Date(lastIn).getTime();
            lastIn = null;
          }
        }
        const workedHours = Math.round((totalMs / (1000 * 60 * 60)) * 100) / 100;

        const { data: existing } = await sup
          .from('time_balance')
          .select('id, total_hours, extra_hours, debit_hours, final_balance')
          .eq('user_id', u.id)
          .eq('month', monthStr)
          .maybeSingle();

        const prevTotal = existing?.total_hours ?? 0;
        const prevExtra = existing?.extra_hours ?? 0;
        const prevDebit = existing?.debit_hours ?? 0;
        const newTotal = prevTotal + workedHours;
        const newFinal = newTotal - prevDebit - (8 * new Date(parseInt(monthStr.slice(0, 4), 10), parseInt(monthStr.slice(5, 7), 10) - 1, 0).getDate());

        if (existing?.id) {
          await sup.from('time_balance').update({
            total_hours: newTotal,
            final_balance: newFinal,
            updated_at: new Date().toISOString(),
          }).eq('id', existing.id);
        } else {
          await sup.from('time_balance').insert({
            user_id: u.id,
            month: monthStr,
            total_hours: newTotal,
            extra_hours: prevExtra,
            debit_hours: prevDebit,
            final_balance: newFinal,
          });
        }
        processed++;
      } catch (e: unknown) {
        errors.push(`${u.id}: ${messageFromUnknown(e, 'Erro')}`);
      }
    }

    console.log('[API RESPONSE]', route, Date.now());
    return Response.json(
      { ok: true, processed, date: dateStr, errors: errors.slice(0, 10) },
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: unknown) {
    console.log('[API RESPONSE]', route, Date.now());
    return Response.json(
      { error: messageFromUnknown(e, 'Erro ao processar'), code: 'PROCESS_ERROR' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export default { fetch: handler };
