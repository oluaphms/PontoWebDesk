/**
 * Cadastro mínimo de sobreaviso (tabela `sobre_aviso`) — preparação para cálculo futuro.
 */
import { db } from './supabaseClient';

export type SobreAvisoRow = {
  id: string;
  user_id: string;
  company_id: string;
  data: string;
  hora_inicial: string;
  hora_fim: string;
  created_at?: string;
  updated_at?: string;
};

function timeToMinutes(value: string): number {
  const part = String(value || '00:00').trim().slice(0, 5);
  const [h, m] = part.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutos de sobreaviso em um registro (suporta hora_fim no dia seguinte). */
export function computeSobreAvisoMinutes(horaInicial: string, horaFim: string): number {
  const start = timeToMinutes(horaInicial);
  let end = timeToMinutes(horaFim);
  if (end <= start) end += 24 * 60;
  return Math.max(0, end - start);
}

export function sumSobreAvisoMinutes(rows: Pick<SobreAvisoRow, 'hora_inicial' | 'hora_fim'>[]): number {
  return rows.reduce((acc, row) => acc + computeSobreAvisoMinutes(row.hora_inicial, row.hora_fim), 0);
}

export async function listSobreAvisoByUser(
  companyId: string,
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<SobreAvisoRow[]> {
  const rows = (await db.select('sobre_aviso', [
    { column: 'company_id', operator: 'eq', value: companyId },
    { column: 'user_id', operator: 'eq', value: userId },
    { column: 'data', operator: 'gte', value: periodStart },
    { column: 'data', operator: 'lte', value: periodEnd },
  ])) as SobreAvisoRow[];
  return rows ?? [];
}

export type SobreAvisoCadastroInput = {
  user_id: string;
  company_id: string;
  data_inicial: string;
  data_final: string;
  hora_inicial: string;
  hora_fim: string;
};

/** Expande período em um registro por dia civil (estrutura mínima sem alterar motor). */
export async function createSobreAvisoPeriod(
  input: SobreAvisoCadastroInput,
): Promise<{ inserted: number; error: Error | null }> {
  const start = input.data_inicial.slice(0, 10);
  const end = input.data_final.slice(0, 10);
  if (!start || !end || start > end) {
    return { inserted: 0, error: new Error('Período inválido.') };
  }

  const days: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const limit = new Date(`${end}T12:00:00`);
  while (cursor <= limit) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  let inserted = 0;
  try {
    for (const data of days) {
      await db.insert('sobre_aviso', {
        user_id: input.user_id,
        company_id: input.company_id,
        data,
        hora_inicial: input.hora_inicial,
        hora_fim: input.hora_fim,
      });
      inserted += 1;
    }
    return { inserted, error: null };
  } catch (err) {
    return {
      inserted,
      error: err instanceof Error ? err : new Error('Falha ao cadastrar sobreaviso.'),
    };
  }
}
