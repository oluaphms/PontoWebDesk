/**
 * Consolidação da folha de pagamento simplificada:
 * líquido = salário base + soma(proventos em lançamentos) − soma(descontos em lançamentos).
 * Eventos com natureza "informativo" não entram no cálculo.
 *
 * Não implementa motor legal: INSS/IRRF progressivos, FGTS, DSR sobre salário, férias + 1/3,
 * 13º, encargos patronais etc. — apenas somatórios a partir de lançamentos informados.
 */

import { db, checkSupabaseConfigured, isSupabaseConfigured, type DbRow } from '../../services/supabaseClient';

export type EventoNatureza = 'provento' | 'desconto' | 'informativo';

function monthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { start, end };
}

export interface ConsolidarFolhaResult {
  periodoId: string;
  funcionarios: number;
}

/**
 * Recalcula todos os itens do período (apaga itens anteriores e reinsere).
 * Período deve estar em rascunho.
 */
export async function consolidarFolhaPeriodo(
  companyId: string,
  year: number,
  month: number,
): Promise<ConsolidarFolhaResult> {
  if (!checkSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const { start, end } = monthRange(year, month);

  const periodos = (await db.select('folha_pagamento_periodos', [
    { column: 'company_id', operator: 'eq', value: companyId },
    { column: 'ano', operator: 'eq', value: year },
    { column: 'mes', operator: 'eq', value: month },
  ])) as DbRow[];
  let periodoId: string;
  if (periodos?.length) {
    const p = periodos[0];
    if (p.status === 'fechada') {
      throw new Error('Período fechado. Reabra como rascunho antes de consolidar novamente.');
    }
    periodoId = String(p.id ?? '');
  } else {
    const inserted = (await db.insert('folha_pagamento_periodos', {
      id: crypto.randomUUID(),
      company_id: companyId,
      ano: year,
      mes: month,
      status: 'rascunho',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })) as DbRow;
    periodoId = inserted?.id != null ? String(inserted.id) : '';
    if (!periodoId) throw new Error('Não foi possível criar o período de folha.');
  }

  const users = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }])) as DbRow[];
  const employees = (users ?? []).filter((u: DbRow) => {
    if (u.status === 'inactive') return false;
    return u.role === 'employee' || u.role === 'hr';
  });

  const eventosRows = (await db.select('eventos_folha', [{ column: 'company_id', operator: 'eq', value: companyId }])) as DbRow[];
  const naturezaByEventoId = new Map<string, EventoNatureza>(
    (eventosRows ?? []).map((e: DbRow) => [String(e.id), (String(e.natureza || 'provento')) as EventoNatureza]),
  );

  const lancamentos = (await db.select('lancamento_eventos', [
    { column: 'company_id', operator: 'eq', value: companyId },
  ])) as DbRow[];

  const inRange = (d: string) => d >= start && d <= end;
  const lancamentosMes = (lancamentos ?? []).filter((l: DbRow) => l.data && inRange(String(l.data).slice(0, 10)));

  const byUser = new Map<string, typeof lancamentosMes>();
  for (const l of lancamentosMes) {
    const uid = String(l.user_id ?? '');
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(l);
  }

  const existingItens = (await db.select('folha_pagamento_itens', [
    { column: 'periodo_id', operator: 'eq', value: periodoId },
  ])) as DbRow[];
  for (const it of existingItens ?? []) {
    await db.delete('folha_pagamento_itens', String(it.id ?? ''));
  }

  let count = 0;
  const now = new Date().toISOString();

  for (const emp of employees) {
    const uid = String(emp.id ?? '');
    if (!uid) continue;
    const salarioBase = Number(emp.salario_base) || 0;
    const lines = byUser.get(uid) ?? [];
    let proventos = 0;
    let descontos = 0;
    const byCodigo: Record<string, number> = {};

    for (const l of lines) {
      const nat = naturezaByEventoId.get(String(l.evento_id ?? '')) || 'provento';
      const vt = Number(l.valor_total) || 0;
      const ev = eventosRows?.find((e: DbRow) => e.id === l.evento_id);
      const cod = ev?.codigo || l.evento_id;
      if (nat === 'informativo') continue;
      if (nat === 'desconto') {
        descontos += vt;
        byCodigo[`D:${cod}`] = (byCodigo[`D:${cod}`] || 0) + vt;
      } else {
        proventos += vt;
        byCodigo[`P:${cod}`] = (byCodigo[`P:${cod}`] || 0) + vt;
      }
    }

    const liquido = salarioBase + proventos - descontos;

    await db.insert('folha_pagamento_itens', {
      id: crypto.randomUUID(),
      periodo_id: periodoId,
      user_id: uid,
      company_id: companyId,
      salario_base: salarioBase,
      total_proventos: proventos,
      total_descontos: descontos,
      liquido,
      detalhe_json: {
        lancamentos_no_mes: lines.length,
        por_evento: byCodigo,
      },
      created_at: now,
      updated_at: now,
    });
    count++;
  }

  await db.update('folha_pagamento_periodos', periodoId, {
    updated_at: now,
  });

  return { periodoId, funcionarios: count };
}

export async function fecharFolhaPeriodo(periodoId: string, fechadaPorUserId: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  await db.update('folha_pagamento_periodos', periodoId, {
    status: 'fechada',
    fechada_em: new Date().toISOString(),
    fechada_por: fechadaPorUserId,
  });
}

export async function reabrirFolhaPeriodo(periodoId: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  await db.update('folha_pagamento_periodos', periodoId, {
    status: 'rascunho',
    fechada_em: null,
    fechada_por: null,
  });
}
