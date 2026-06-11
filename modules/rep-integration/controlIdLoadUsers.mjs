/**
 * Payload Control iD load_users.fcgi — tipos corretos (boolean nativo, inteiros).
 * Usado pelo agente Windows e pelo adaptador TS (via import dinâmico ou espelho).
 */

const BOOLEAN_BODY_KEYS = new Set([
  'templates',
  'face',
  'admin',
  'do_match',
  'remove_faces',
  'remove_templates',
  'one_to_one_enabled',
  'enrolling',
  'remote_enrolling',
  'raw',
  'enable',
  'enabled',
  'beep_enabled',
  'animation_enabled',
  'economic_receipt_enabled',
  'low_on_paper',
  'use_dhcp',
  'isFacial',
]);

/**
 * @param {unknown} value
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
export function coerceControlIdBoolean(value, defaultValue = false) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'TRUE' || value === 'yes') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'FALSE' || value === 'no') return false;
  if (value == null || value === '') return defaultValue;
  return defaultValue;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function coercePositiveInt(value, fallback) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * @param {string} text
 * @returns {string | null}
 */
export function parseControlIdBooleanFieldError(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (!/booleano/i.test(raw)) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      const field = o.field ?? o.campo ?? o.param ?? o.parameter ?? o.key;
      if (field != null && String(field).trim()) return String(field).trim();
    }
  } catch {
    /* texto plano */
  }
  const m = raw.match(/["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?\s*[:=]?\s*(?:deve|deves)/i);
  if (m?.[1]) return m[1];
  if (/templates/i.test(raw)) return 'templates';
  if (/do_match/i.test(raw)) return 'do_match';
  return null;
}

/**
 * @param {{
 *   limit?: number;
 *   offset?: number;
 *   mode671?: boolean;
 *   deviceExtra?: Record<string, unknown> | null;
 *   includeTemplates?: boolean;
 *   isFacial?: boolean | null;
 * }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildControlIdLoadUsersPayload(options = {}) {
  const limit = Math.min(100, coercePositiveInt(options.limit, 100));
  const offset = coercePositiveInt(options.offset, 0);
  const extraRaw =
    options.deviceExtra?.load_users_body && typeof options.deviceExtra.load_users_body === 'object'
      ? options.deviceExtra.load_users_body
      : null;

  /** iDClass / REP: templates explícito como boolean (evita HTTP 400 «deves ser do tipo booleano»). */
  const includeTemplates =
    options.includeTemplates === true ||
    coerceControlIdBoolean(extraRaw?.templates, false) === true;

  const payload = {
    limit,
    offset,
    templates: includeTemplates,
  };

  if (extraRaw && typeof extraRaw === 'object' && !Array.isArray(extraRaw)) {
    for (const [key, value] of Object.entries(extraRaw)) {
      if (key === 'limit' || key === 'offset') continue;
      if (BOOLEAN_BODY_KEYS.has(key)) {
        payload[key] = coerceControlIdBoolean(value, false);
      } else if (key === 'users_pis' || key === 'users_cpf') {
        if (Array.isArray(value)) payload[key] = value;
      } else if (value !== undefined && value !== null && value !== '') {
        payload[key] = value;
      }
    }
  }

  payload.limit = limit;
  payload.offset = offset;
  payload.templates = coerceControlIdBoolean(payload.templates, includeTemplates);

  return payload;
}

/**
 * @param {unknown} getAbout
 * @param {unknown} getInfo
 * @returns {'idclass_facial' | 'idclass_rep' | 'access_control' | 'unknown'}
 */
export function detectControlIdDeviceFamily(getAbout, getInfo) {
  const about = getAbout && typeof getAbout === 'object' ? getAbout : null;
  const info = getInfo && typeof getInfo === 'object' ? getInfo : null;
  if (about && coerceControlIdBoolean(about.isFacial, false)) return 'idclass_facial';
  if (info && (info.num_serie != null || info.user_count != null || info.template_count != null)) {
    return 'idclass_rep';
  }
  if (about?.mac != null || about?.nSerie != null) return 'idclass_rep';
  return 'unknown';
}
