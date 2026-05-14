/**
 * Colunas seguras para `users.select` em API/workers REP sem importar `services/supabaseClient`
 * (evita puxar `services/supabase` + cliente browser no arranque de funções serverless).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

function dedupeCols(cols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cols) {
    const k = String(c || '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Prova `users.select` com o conjunto pedido; em falha tenta um conjunto REP padrão, depois só id/company_id.
 */
export async function repUsersSelectColListForServer(
  client: SupabaseClient,
  requested: readonly string[],
): Promise<string[]> {
  const base = ['id', 'company_id'];
  const want = dedupeCols([...base, ...requested.map((c) => String(c || '').trim())]);

  async function probe(cols: string[]): Promise<boolean> {
    const sel = cols.join(',');
    const { error } = await client.from('users').select(sel).limit(1);
    if (error) {
      console.error('[USERS QUERY ERROR]', error);
      return false;
    }
    return true;
  }

  if (await probe(want)) return want;
  const fallback = dedupeCols([...base, 'pis_pasep', 'pis', 'cpf', 'status', 'invisivel', 'demissao']);
  if (await probe(fallback)) return fallback;
  return ['id', 'company_id'];
}
