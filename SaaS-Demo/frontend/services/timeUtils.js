/**
 * Utilitários de timezone centralizados.
 *
 * REGRA GLOBAL: todos os timestamps são armazenados em UTC no banco.
 * Conversão para horário local ocorre APENAS no frontend.
 *
 * Timezone padrão do sistema: America/Sao_Paulo (BRT/BRST)
 */

export const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Converte uma data/hora "wall clock" (sem offset) de um timezone IANA para ISO UTC.
 * Usa binary search sobre Intl.DateTimeFormat para precisão em horário de verão.
 *
 * @param {string} wallDate  — 'YYYY-MM-DD'
 * @param {string} wallTime  — 'HH:MM:SS'
 * @param {string} [tz]      — IANA timezone (default: America/Sao_Paulo)
 * @returns {string}         — ISO UTC string (ex: '2024-04-20T11:00:00.000Z')
 */
export function toUTC(wallDate, wallTime, tz = DEFAULT_TZ) {
  const target = `${wallDate} ${wallTime}`;
  const [y, mo, d]  = wallDate.split('-').map(Number);
  const [h, mi, se] = wallTime.split(':').map(Number);

  if (!y || !mo || !d || h == null || mi == null || se == null) {
    // Fallback: tratar como UTC se não conseguir parsear
    return new Date(`${wallDate}T${wallTime}.000Z`).toISOString();
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });

  // Janela de busca: ±2 dias em torno da data local
  let lo = Date.UTC(y, mo - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, mo - 1, d + 2, 23, 59, 59);

  for (let i = 0; i < 56; i++) {
    if (lo > hi) break;
    const mid  = Math.floor((lo + hi) / 2);
    const wall = formatter.format(new Date(mid)).replace('T', ' ');
    if (wall === target) {
      // Encontrou — recuar para o primeiro ms com esse wall time (DST ambiguidade)
      let first = mid;
      for (let k = 0; k < 1100; k++) {
        const prev = first - 1;
        if (formatter.format(new Date(prev)).replace('T', ' ') !== target) break;
        first = prev;
      }
      return new Date(first).toISOString();
    }
    if (wall < target) lo = mid + 1;
    else hi = mid - 1;
  }

  // Fallback: offset fixo -03:00 (BRT sem horário de verão)
  return new Date(`${wallDate}T${wallTime}-03:00`).toISOString();
}

/**
 * Garante que um valor de timestamp está em UTC ISO.
 * Se já for UTC (termina em Z ou +00:00), retorna como está.
 * Se for wall time sem offset, converte usando `tz`.
 *
 * @param {string} ts  — timestamp de qualquer formato
 * @param {string} [tz]
 * @returns {string}   — ISO UTC
 */
export function ensureUTC(ts, tz = DEFAULT_TZ) {
  if (!ts) return new Date().toISOString();
  // Já tem offset explícito → deixar o Date parsear
  if (/[Z+\-]\d{0,2}:?\d{0,2}$/.test(ts.trim())) {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  // Wall time sem offset: 'YYYY-MM-DDTHH:MM:SS' ou 'YYYY-MM-DD HH:MM:SS'
  const normalized = ts.replace(' ', 'T');
  const [datePart, timePart] = normalized.split('T');
  if (datePart && timePart) {
    return toUTC(datePart, timePart.split('.')[0], tz);
  }
  return new Date(ts).toISOString();
}

/**
 * Formata um timestamp UTC para exibição no frontend (horário local).
 * NÃO usar no backend — apenas para display.
 *
 * @param {string|Date} utcTs
 * @param {string} [tz]
 * @param {Intl.DateTimeFormatOptions} [opts]
 * @returns {string}
 */
export function formatLocal(utcTs, tz = DEFAULT_TZ, opts = {}) {
  const d = utcTs instanceof Date ? utcTs : new Date(utcTs);
  return d.toLocaleString('pt-BR', { timeZone: tz, ...opts });
}

/**
 * Retorna o início do dia em UTC para um timezone local.
 * Útil para filtros de "hoje" no banco.
 *
 * @param {Date} [date]  — data de referência (default: agora)
 * @param {string} [tz]
 * @returns {string}     — ISO UTC do início do dia local
 */
export function startOfDayUTC(date = new Date(), tz = DEFAULT_TZ) {
  const local = date.toLocaleDateString('sv-SE', { timeZone: tz }); // 'YYYY-MM-DD'
  return toUTC(local, '00:00:00', tz);
}

/**
 * Retorna o fim do dia em UTC para um timezone local.
 *
 * @param {Date} [date]
 * @param {string} [tz]
 * @returns {string}
 */
export function endOfDayUTC(date = new Date(), tz = DEFAULT_TZ) {
  const local = date.toLocaleDateString('sv-SE', { timeZone: tz });
  return toUTC(local, '23:59:59', tz);
}
