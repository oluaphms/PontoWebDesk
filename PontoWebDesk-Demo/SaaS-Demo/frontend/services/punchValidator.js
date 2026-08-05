/**
 * Validação de integridade de batidas antes da ingestão.
 *
 * PROTEÇÕES:
 * 1. Clock drift: rejeita timestamps > +5min no futuro ou > 30 dias no passado
 * 2. Employee ID: valida formato (PIS 11 dígitos, CPF 11 dígitos, ou matrícula não-vazia)
 * 3. Flood detection: detecta > 10 batidas do mesmo employee em 1 minuto
 * 4. Rate limit por device: > 60 batidas/minuto → throttle
 * 5. Schema lock: valida campos obrigatórios e tipos
 *
 * Todos os erros são classificados e logados com contexto completo.
 * Registros inválidos são rejeitados antes de entrar na fila — nunca chegam ao Supabase.
 */

export const VALIDATION_RESULT = /** @type {const} */ ({
  OK:          'OK',
  CLOCK_DRIFT: 'CLOCK_DRIFT_ERROR',
  INVALID_ID:  'INVALID_EMPLOYEE_ID',
  FLOOD:       'FLOOD_DETECTED',
  RATE_LIMIT:  'DEVICE_RATE_LIMIT',
  SCHEMA:      'SCHEMA_ERROR',
});

// ─── Limites ───────────────────────────────────────────────────────────────────

const CLOCK_FUTURE_MS  = 5  * 60_000;   // +5 min no futuro
const CLOCK_PAST_MS    = 30 * 86_400_000; // 30 dias no passado
const FLOOD_WINDOW_MS  = 60_000;          // janela de flood (1 min)
const FLOOD_MAX        = 10;              // máx batidas por employee por minuto
const DEVICE_RATE_MAX  = 60;             // máx batidas por device por minuto
const DEVICE_RATE_WIN  = 60_000;

// ─── Estado em memória (por processo) ─────────────────────────────────────────
// Janelas deslizantes leves — não precisam de persistência.

/** @type {Map<string, number[]>} employee_id → timestamps recentes */
const employeeWindow = new Map();

/** @type {Map<string, number[]>} device_id → timestamps recentes */
const deviceWindow = new Map();

/** Limpa entradas antigas das janelas deslizantes. */
function pruneWindow(map, windowMs) {
  const cutoff = Date.now() - windowMs;
  for (const [key, times] of map.entries()) {
    const pruned = times.filter(t => t > cutoff);
    if (pruned.length === 0) map.delete(key);
    else map.set(key, pruned);
  }
}

// Limpeza periódica para evitar memory leak (a cada 5 min)
setInterval(() => {
  pruneWindow(employeeWindow, FLOOD_WINDOW_MS);
  pruneWindow(deviceWindow, DEVICE_RATE_WIN);
}, 5 * 60_000);

// ─── Validações individuais ────────────────────────────────────────────────────

/**
 * Valida clock drift.
 * @param {string} timestamp — ISO UTC
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateClockDrift(timestamp) {
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts)) return { ok: false, reason: 'timestamp inválido (não é ISO)' };

  const now = Date.now();
  if (ts > now + CLOCK_FUTURE_MS) {
    const diffMin = Math.round((ts - now) / 60_000);
    return { ok: false, reason: `timestamp ${diffMin}min no futuro (limite: +5min)` };
  }
  if (ts < now - CLOCK_PAST_MS) {
    const diffDays = Math.round((now - ts) / 86_400_000);
    return { ok: false, reason: `timestamp ${diffDays} dias no passado (limite: 30 dias)` };
  }
  return { ok: true };
}

/**
 * Valida formato do employee_id.
 * Aceita: PIS/CPF (11 dígitos numéricos) ou matrícula (string não-vazia, max 50 chars).
 * @param {string} employeeId
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateEmployeeId(employeeId) {
  if (!employeeId || typeof employeeId !== 'string') {
    return { ok: false, reason: 'employee_id ausente ou não é string' };
  }
  const trimmed = employeeId.trim();
  if (!trimmed || trimmed === 'unknown') {
    return { ok: false, reason: 'employee_id vazio ou "unknown"' };
  }
  if (trimmed.length > 50) {
    return { ok: false, reason: `employee_id muito longo (${trimmed.length} chars, máx 50)` };
  }
  // PIS/CPF: exatamente 11 dígitos
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11) return { ok: true };
  // Matrícula: qualquer string não-vazia (já validada acima)
  return { ok: true };
}

/**
 * Detecta flood de batidas do mesmo employee.
 * @param {string} employeeId
 * @param {string} deviceId
 * @returns {{ ok: boolean, reason?: string, count?: number }}
 */
export function checkFlood(employeeId, deviceId) {
  const key = `${employeeId}:${deviceId}`;
  const now = Date.now();
  const cutoff = now - FLOOD_WINDOW_MS;

  const times = (employeeWindow.get(key) ?? []).filter(t => t > cutoff);
  times.push(now);
  employeeWindow.set(key, times);

  if (times.length > FLOOD_MAX) {
    return {
      ok: false,
      reason: `flood detectado: ${times.length} batidas em 1 minuto (limite: ${FLOOD_MAX})`,
      count: times.length,
    };
  }
  return { ok: true, count: times.length };
}

/**
 * Verifica rate limit por device.
 * @param {string} deviceId
 * @returns {{ ok: boolean, reason?: string, count?: number }}
 */
export function checkDeviceRateLimit(deviceId) {
  const now = Date.now();
  const cutoff = now - DEVICE_RATE_WIN;

  const times = (deviceWindow.get(deviceId) ?? []).filter(t => t > cutoff);
  times.push(now);
  deviceWindow.set(deviceId, times);

  if (times.length > DEVICE_RATE_MAX) {
    return {
      ok: false,
      reason: `rate limit do device: ${times.length} batidas/min (limite: ${DEVICE_RATE_MAX})`,
      count: times.length,
    };
  }
  return { ok: true, count: times.length };
}

/**
 * Valida schema mínimo de uma batida.
 * @param {object} punch
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateSchema(punch) {
  if (!punch || typeof punch !== 'object') {
    return { ok: false, reason: 'payload não é objeto' };
  }
  const required = ['employee_id', 'occurred_at', 'event_type', 'device_id', 'company_id', 'dedupe_hash'];
  for (const field of required) {
    if (!punch[field]) return { ok: false, reason: `campo obrigatório ausente: ${field}` };
  }
  const validEventTypes = ['entrada', 'saída', 'saida', 'pausa', 'batida'];
  if (!validEventTypes.includes(String(punch.event_type).toLowerCase())) {
    return { ok: false, reason: `event_type inválido: "${punch.event_type}"` };
  }
  return { ok: true };
}

// ─── Validação completa ────────────────────────────────────────────────────────

/**
 * Executa todas as validações em uma batida.
 * Retorna { ok, result, reason } onde result é VALIDATION_RESULT.
 *
 * @param {{
 *   employee_id: string,
 *   occurred_at: string,
 *   event_type: string,
 *   device_id: string,
 *   company_id: string,
 *   dedupe_hash: string,
 * }} punch
 * @param {{ skipFlood?: boolean, skipRateLimit?: boolean }} [opts]
 * @returns {{ ok: boolean, result: string, reason?: string }}
 */
export function validatePunch(punch, opts = {}) {
  // 1. Schema
  const schema = validateSchema(punch);
  if (!schema.ok) return { ok: false, result: VALIDATION_RESULT.SCHEMA, reason: schema.reason };

  // 2. Clock drift
  const drift = validateClockDrift(punch.occurred_at);
  if (!drift.ok) return { ok: false, result: VALIDATION_RESULT.CLOCK_DRIFT, reason: drift.reason };

  // 3. Employee ID
  const empId = validateEmployeeId(punch.employee_id);
  if (!empId.ok) return { ok: false, result: VALIDATION_RESULT.INVALID_ID, reason: empId.reason };

  // 4. Rate limit por device
  if (!opts.skipRateLimit) {
    const rate = checkDeviceRateLimit(punch.device_id);
    if (!rate.ok) return { ok: false, result: VALIDATION_RESULT.RATE_LIMIT, reason: rate.reason };
  }

  // 5. Flood por employee
  if (!opts.skipFlood) {
    const flood = checkFlood(punch.employee_id, punch.device_id);
    if (!flood.ok) return { ok: false, result: VALIDATION_RESULT.FLOOD, reason: flood.reason };
  }

  return { ok: true, result: VALIDATION_RESULT.OK };
}

/**
 * Filtra um array de batidas, separando válidas de inválidas.
 * Retorna { valid, rejected } com motivo de rejeição para cada inválida.
 *
 * @param {object[]} punches
 * @param {object} [opts]
 * @returns {{ valid: object[], rejected: Array<{ punch: object, result: string, reason: string }> }}
 */
export function filterValidPunches(punches, opts = {}) {
  const valid = [];
  const rejected = [];

  for (const punch of punches) {
    const check = validatePunch(punch, opts);
    if (check.ok) {
      valid.push(punch);
    } else {
      rejected.push({ punch, result: check.result, reason: check.reason ?? 'unknown' });
    }
  }

  return { valid, rejected };
}

/**
 * Retorna estatísticas das janelas de rate limit (para métricas/debug).
 */
export function getRateLimitStats() {
  const now = Date.now();
  const empStats = [];
  for (const [key, times] of employeeWindow.entries()) {
    const recent = times.filter(t => t > now - FLOOD_WINDOW_MS);
    if (recent.length > 0) empStats.push({ key, count: recent.length });
  }
  const devStats = [];
  for (const [key, times] of deviceWindow.entries()) {
    const recent = times.filter(t => t > now - DEVICE_RATE_WIN);
    if (recent.length > 0) devStats.push({ key, count: recent.length });
  }
  return {
    employeeWindows: empStats.sort((a, b) => b.count - a.count).slice(0, 10),
    deviceWindows:   devStats.sort((a, b) => b.count - a.count).slice(0, 10),
  };
}
