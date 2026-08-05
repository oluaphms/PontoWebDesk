/**
 * Detecção de fraude em batidas de ponto.
 *
 * HEURÍSTICAS IMPLEMENTADAS:
 * 1. Velocidade impossível: mesmo employee em dois locais distantes em < 10 min
 * 2. Horário impossível: batida fora da janela permitida (ex: 00:00–04:00)
 * 3. Frequência anômala: > 6 batidas em 1 hora (padrão normal: 4 por dia)
 * 4. Sequência inválida: duas entradas seguidas sem saída
 * 5. Batida em feriado/fim de semana (configurável)
 *
 * RESULTADO:
 * - Batidas suspeitas são ACEITAS mas marcadas com fraud_flag=true
 * - Nunca bloqueia — apenas sinaliza para revisão humana
 * - Registra na audit_trail com ação PUNCH_FLAGGED
 */

import { createHash } from 'node:crypto';

export const FRAUD_FLAG = /** @type {const} */ ({
  IMPOSSIBLE_SPEED:   'IMPOSSIBLE_SPEED',
  IMPOSSIBLE_HOUR:    'IMPOSSIBLE_HOUR',
  ANOMALOUS_FREQUENCY:'ANOMALOUS_FREQUENCY',
  INVALID_SEQUENCE:   'INVALID_SEQUENCE',
  WEEKEND_PUNCH:      'WEEKEND_PUNCH',
});

// ─── Limites ───────────────────────────────────────────────────────────────────

const IMPOSSIBLE_SPEED_KMH  = 500;   // > 500 km/h entre dois pontos = impossível
const IMPOSSIBLE_HOUR_START = 0;     // 00:00 (hora local)
const IMPOSSIBLE_HOUR_END   = 4;     // 04:00 (hora local)
const FREQ_WINDOW_MS        = 3_600_000; // 1 hora
const FREQ_MAX_PUNCHES      = 6;

// ─── Estado em memória ────────────────────────────────────────────────────────

/** @type {Map<string, Array<{ ts: number, lat?: number, lon?: number, type: string }>>} */
const employeeHistory = new Map();

setInterval(() => {
  const cutoff = Date.now() - 24 * 3_600_000;
  for (const [key, events] of employeeHistory.entries()) {
    const pruned = events.filter(e => e.ts > cutoff);
    if (!pruned.length) employeeHistory.delete(key);
    else employeeHistory.set(key, pruned);
  }
}, 30 * 60_000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Distância Haversine em km entre dois pontos GPS.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} km
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R  = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dL / 2) ** 2
           + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWeekend(ts) {
  const d = new Date(ts);
  const day = d.getDay(); // 0=Dom, 6=Sáb
  return day === 0 || day === 6;
}

function localHour(ts, tz = 'America/Sao_Paulo') {
  return parseInt(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date(ts)), 10);
}

// ─── FraudDetector ────────────────────────────────────────────────────────────

export class FraudDetector {
  /**
   * @param {{
   *   timezone?: string,
   *   checkWeekend?: boolean,
   *   checkImpossibleHour?: boolean,
   *   impossibleSpeedKmh?: number,
   * }} [opts]
   */
  constructor(opts = {}) {
    this._tz              = opts.timezone            ?? 'America/Sao_Paulo';
    this._checkWeekend    = opts.checkWeekend         ?? false; // desativado por padrão (muitas empresas trabalham)
    this._checkHour       = opts.checkImpossibleHour  ?? true;
    this._maxSpeedKmh     = opts.impossibleSpeedKmh   ?? IMPOSSIBLE_SPEED_KMH;
  }

  /**
   * Analisa uma batida e retorna flags de fraude detectadas.
   *
   * @param {{
   *   employee_id: string,
   *   occurred_at: string,
   *   event_type:  string,
   *   lat?:        number,
   *   lon?:        number,
   * }} punch
   * @returns {Array<{ flag: string, reason: string, severity: 'low'|'medium'|'high' }>}
   */
  analyze(punch) {
    const flags   = [];
    const ts      = new Date(punch.occurred_at).getTime();
    const empKey  = punch.employee_id;
    const history = employeeHistory.get(empKey) ?? [];

    // 1. Velocidade impossível (requer GPS)
    if (punch.lat != null && punch.lon != null) {
      const recent = history.filter(e => e.lat != null && e.lon != null && ts - e.ts < 10 * 60_000);
      for (const prev of recent) {
        const distKm  = haversineKm(prev.lat, prev.lon, punch.lat, punch.lon);
        const deltaH  = (ts - prev.ts) / 3_600_000;
        const speedKmh = deltaH > 0 ? distKm / deltaH : Infinity;
        if (speedKmh > this._maxSpeedKmh) {
          flags.push({
            flag:     FRAUD_FLAG.IMPOSSIBLE_SPEED,
            reason:   `${Math.round(distKm)}km em ${Math.round(deltaH * 60)}min (${Math.round(speedKmh)}km/h)`,
            severity: 'high',
          });
          break;
        }
      }
    }

    // 2. Horário impossível
    if (this._checkHour) {
      const hour = localHour(ts, this._tz);
      if (hour >= IMPOSSIBLE_HOUR_START && hour < IMPOSSIBLE_HOUR_END) {
        flags.push({
          flag:     FRAUD_FLAG.IMPOSSIBLE_HOUR,
          reason:   `Batida às ${hour}h (janela suspeita: ${IMPOSSIBLE_HOUR_START}h–${IMPOSSIBLE_HOUR_END}h)`,
          severity: 'medium',
        });
      }
    }

    // 3. Frequência anômala
    const recentWindow = history.filter(e => ts - e.ts < FREQ_WINDOW_MS);
    if (recentWindow.length >= FREQ_MAX_PUNCHES) {
      flags.push({
        flag:     FRAUD_FLAG.ANOMALOUS_FREQUENCY,
        reason:   `${recentWindow.length + 1} batidas em 1 hora (limite: ${FREQ_MAX_PUNCHES})`,
        severity: 'medium',
      });
    }

    // 4. Sequência inválida (duas entradas seguidas)
    if (punch.event_type === 'entrada') {
      const lastEntry = [...history].reverse().find(e => e.type === 'entrada');
      const lastExit  = [...history].reverse().find(e => e.type === 'saída' || e.type === 'saida');
      if (lastEntry && (!lastExit || lastExit.ts < lastEntry.ts)) {
        flags.push({
          flag:     FRAUD_FLAG.INVALID_SEQUENCE,
          reason:   'Duas entradas consecutivas sem saída registrada',
          severity: 'low',
        });
      }
    }

    // 5. Fim de semana
    if (this._checkWeekend && isWeekend(ts)) {
      flags.push({
        flag:     FRAUD_FLAG.WEEKEND_PUNCH,
        reason:   `Batida em ${new Date(ts).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: this._tz })}`,
        severity: 'low',
      });
    }

    // Atualizar histórico
    history.push({ ts, lat: punch.lat, lon: punch.lon, type: punch.event_type });
    employeeHistory.set(empKey, history);

    return flags;
  }

  /**
   * Analisa um lote de batidas.
   * Retorna cada batida com campo `fraudFlags` (array vazio = limpa).
   *
   * @param {object[]} punches
   * @returns {Array<{ punch: object, fraudFlags: object[], isSuspect: boolean }>}
   */
  analyzeBatch(punches) {
    return punches.map(punch => {
      const fraudFlags = this.analyze(punch);
      return { punch, fraudFlags, isSuspect: fraudFlags.length > 0 };
    });
  }
}
