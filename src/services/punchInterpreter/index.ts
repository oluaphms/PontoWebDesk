/**
 * Motor de interpretação automática de marcações
 * Analisa todas as marcações do dia, identifica pares entrada/saída,
 * detecta inconsistências e sugere correções (ex: entrada presumida).
 */

import { db, isSupabaseConfigured } from '../../../services/supabaseClient';

export type InterpretationStatus = 'normal' | 'corrigido' | 'suspeito';

export type CorrectionType =
  | 'missing_entry'
  | 'missing_exit'
  | 'irregular_interval'
  | 'duplicate'
  | 'invalid_sequence';

export interface CorrectionSuggestion {
  type: CorrectionType;
  description: string;
  suggested_value?: string;
  record_id?: string;
}

export interface PunchInterpretationResult {
  employee_id: string;
  date: string;
  status: InterpretationStatus;
  corrections: CorrectionSuggestion[];
  justification: string | null;
  pairs: { entrada: string; saida: string }[];
  raw_records: { id: string; type: string; timestamp: string }[];
}

interface TimeRecordRow {
  id: string;
  user_id: string;
  type: string;
  timestamp?: string | null;
  created_at: string;
}

function normalizeType(type: string): 'entrada' | 'saída' | 'pausa' {
  const t = (type || '').toLowerCase();
  if (t === 'saída' || t === 'saida') return 'saída';
  if (t === 'entrada') return 'entrada';
  if (t === 'pausa') return 'pausa';
  return t as 'entrada' | 'saída' | 'pausa';
}

function getRecordTime(r: TimeRecordRow): number {
  const ts = r.timestamp || r.created_at;
  return new Date(ts).getTime();
}

/**
 * Interpreta a sequência de marcações do dia para um funcionário.
 * Identifica pares entrada/saída, detecta erros e sugere correções.
 */
export async function interpretPunchSequence(
  employeeId: string,
  date: string
): Promise<PunchInterpretationResult> {
  const result: PunchInterpretationResult = {
    employee_id: employeeId,
    date,
    status: 'normal',
    corrections: [],
    justification: null,
    pairs: [],
    raw_records: [],
  };

  if (!isSupabaseConfigured()) return result;

  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const rows = (await db.select(
    'time_records',
    [
      { column: 'user_id', operator: 'eq', value: employeeId },
      { column: 'created_at', operator: 'gte', value: start },
      { column: 'created_at', operator: 'lte', value: end },
    ],
    { column: 'created_at', ascending: true },
    50
  )) as unknown as TimeRecordRow[];

  const records = (rows ?? []).map((r) => ({
    id: r.id,
    type: normalizeType(r.type),
    timestamp: r.timestamp || r.created_at,
  }));
  result.raw_records = records.map((r) => ({ id: r.id, type: r.type, timestamp: r.timestamp }));

  const sorted = [...records].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Detecção de duplicidade: mesmo tipo em sequência muito próxima (< 2 min)
  const dupThreshold = 2 * 60 * 1000;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].timestamp).getTime();
    const curr = new Date(sorted[i].timestamp).getTime();
    if (sorted[i - 1].type === sorted[i].type && curr - prev < dupThreshold) {
      result.corrections.push({
        type: 'duplicate',
        description: `Marcação duplicada (${sorted[i].type})`,
        record_id: sorted[i].id,
      });
    }
  }

  // Sequência inválida: saída antes de entrada, ou duas entradas seguidas sem saída
  let lastType: string | null = null;
  for (const r of sorted) {
    if (r.type === 'saída' && lastType !== 'entrada' && lastType !== 'pausa') {
      result.corrections.push({
        type: 'invalid_sequence',
        description: 'Saída sem entrada anterior (entrada presumida)',
        suggested_value: 'entrada',
        record_id: r.id,
      });
    }
    if (r.type === 'entrada' && lastType === 'entrada') {
      result.corrections.push({
        type: 'missing_exit',
        description: 'Entrada sem saída anterior (saída presumida)',
        suggested_value: 'saída',
      });
    }
    lastType = r.type;
  }

  // Montar pares entrada -> saída (ou entrada -> pausa -> entrada -> saída)
  const pairs: { entrada: string; saida: string }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const r = sorted[i];
    if (r.type === 'entrada') {
      let saidaTime: string | null = null;
      let j = i + 1;
      while (j < sorted.length) {
        if (sorted[j].type === 'saída') {
          saidaTime = sorted[j].timestamp;
          break;
        }
        if (sorted[j].type === 'entrada') break;
        j++;
      }
      if (saidaTime) {
        pairs.push({
          entrada: r.timestamp,
          saida: saidaTime,
        });
      } else if (i === sorted.length - 1 || sorted[i + 1].type !== 'pausa') {
        result.corrections.push({
          type: 'missing_exit',
          description: 'Falta marcação de saída no final do dia',
          suggested_value: 'saída',
        });
      }
    }
    i++;
  }
  result.pairs = pairs;

  // Marcação faltante: apenas saídas ou sequência ímpar
  const entradas = sorted.filter((r) => r.type === 'entrada').length;
  const saidas = sorted.filter((r) => r.type === 'saída').length;
  if (saidas > entradas) {
    result.corrections.push({
      type: 'missing_entry',
      description: 'Entrada presumida (mais saídas que entradas)',
      suggested_value: 'entrada',
    });
  }
  if (entradas > saidas && !result.corrections.some((c) => c.type === 'missing_exit')) {
    result.corrections.push({
      type: 'missing_exit',
      description: 'Saída presumida (mais entradas que saídas)',
      suggested_value: 'saída',
    });
  }

  if (result.corrections.length > 0) {
    result.status = result.corrections.some((c) => c.type === 'duplicate' || c.type === 'invalid_sequence')
      ? 'suspeito'
      : 'corrigido';
  }

  return result;
}

/**
 * Persiste o resultado da interpretação na tabela punch_interpretations (upsert).
 */
export async function saveInterpretation(
  _supabase: import('@supabase/supabase-js').SupabaseClient | null,
  result: PunchInterpretationResult,
  companyId: string
): Promise<void> {
  await db.upsert(
    'punch_interpretations',
    {
      employee_id: result.employee_id,
      company_id: companyId,
      date: result.date,
      status: result.status,
      corrections: result.corrections,
      justification: result.justification,
      updated_at: new Date().toISOString(),
    },
    'employee_id,date',
  );
}
