import { observabilityConsole } from '../../../src/shared/logger/observabilityConsole';
/**
 * Control iD — API REP iDClass (documentação: api_idclass / *.fcgi).
 * Não usa /api/v1/punches: sessão via POST /login.fcgi e marcações via POST /get_afd.fcgi (AFD).
 */

import type {
  RepDevice,
  RepVendorAdapter,
  PunchFromDevice,
  RepConnectionTestResult,
  RepEmployeePayload,
  RepDeviceClockSet,
  RepUserFromDevice,
} from '../types';
import { deviceFetch } from '../repDeviceHttp';
import {
  parseAFD,
  parseAfdLine,
  afdRecordWallTimeToUtcIso,
  wallTimeInZoneToUtcMs,
  matriculaFromAfdPisField,
  extractAfdLineIdentifierDigitBlob,
} from '../repParser';
import {
  normalizeDocument,
  sanitizeDigits,
  tryNormalizeBrazilianPisTo11Digits,
  elevenPisDigitsToControlIdApiInteger,
  validatePisPasep11,
  repAfdCanonical11DigitsFromBlob,
} from '../pisPasep';

function extra(device: RepDevice): Record<string, unknown> {
  return device.config_extra && typeof device.config_extra === 'object'
    ? (device.config_extra as Record<string, unknown>)
    : {};
}

function readMode671Flag(ex: Record<string, unknown>): boolean {
  const v = ex.mode_671;
  if (v === true) return true;
  if (typeof v === 'string') {
    const n = v.trim().toLowerCase();
    return n === 'true' || n === '1' || n === 'yes' || n === 'on';
  }
  if (typeof v === 'number') return v === 1;
  return false;
}

function credentials(device: RepDevice): { login: string; password: string } {
  const ex = extra(device);
  const loginRaw = String(ex.rep_login ?? ex.login ?? 'admin').trim();
  const passRaw = String(ex.rep_password ?? ex.password ?? 'admin').trim();
  return {
    login: loginRaw || 'admin',
    password: passRaw,
  };
}

function loginBodyFromDevice(device: RepDevice, login: string, password: string): string {
  const ex = extra(device);
  const raw = ex.controlid_login_body;
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = { ...(raw as Record<string, unknown>), login, password };
    return JSON.stringify(o);
  }
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return JSON.stringify({ ...o, login, password });
    } catch {
      /* fallback abaixo */
    }
  }
  return JSON.stringify({ login, password });
}

async function controlIdLogin(device: RepDevice): Promise<{ session: string } | { error: string }> {
  const { login, password } = credentials(device);
  const debug = (process.env.CONTROLID_LOGIN_DEBUG || '').trim() === '1';
  if (debug) {
    observabilityConsole.debug('[Control iD][login] usuário (tamanho)', login.length, '| senha (tamanho)', password.length);
  }

  const tryBodies: string[] = [loginBodyFromDevice(device, login, password)];
  if (!extra(device).controlid_login_body) {
    tryBodies.push(JSON.stringify({ login, passwd: password }));
    tryBodies.push(JSON.stringify({ user: login, password }));
  }

  let lastText = '';
  let lastStatus = 0;
  for (const body of tryBodies) {
    const res = await deviceFetch(device, '/login.fcgi', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        Expect: '',
      },
      body,
    });
    lastText = await res.text();
    lastStatus = res.status;
    if (res.ok) {
      const text = lastText;
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return { error: 'Login Control iD: resposta não é JSON. Confirme HTTPS, porta (443) e credenciais.' };
      }
      const o = data as Record<string, unknown>;
      const session = o.session;
      if (typeof session !== 'string' || !session) {
        return {
          error: `Login Control iD: campo "session" ausente. Resposta: ${JSON.stringify(data).slice(0, 240)}`,
        };
      }
      return { session };
    }
    if (res.status !== 401) {
      return { error: `Login Control iD: HTTP ${res.status} — ${lastText.slice(0, 240)}` };
    }
  }
  return { error: `Login Control iD: HTTP ${lastStatus} — ${lastText.slice(0, 240)}` };
}

/** Heurística: conteúdo AFD (NSR + DDMMAAAA + HHMMSS ou NSR+tipo+data), não JSON de status. */
function looksLikeAfdPayload(s: string): boolean {
  const t = s.trim();
  if (t.length < 18) return false;
  const first = (t.split(/\r?\n/).find(Boolean) || t).replace(/\s/g, '');
  if (/^\d{9}[37]\d{8}\d{6}/.test(first)) return true;
  return /^\d/.test(t) && /\d{8}[\s\t]*\d{4,6}/.test(t);
}

function tryDecodeBase64ToAfd(s: string): string | null {
  const raw = s.replace(/\s+/g, '');
  if (raw.length < 32 || raw.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) return null;
  try {
    const dec = Buffer.from(raw, 'base64').toString('utf8');
    if (looksLikeAfdPayload(dec) || parseAFD(dec).length > 0) return dec;
  } catch {
    return null;
  }
  return null;
}

function stringifyAfdFromJsonValue(v: unknown): string | null {
  if (typeof v === 'string') {
    const b64 = tryDecodeBase64ToAfd(v);
    if (b64) return b64;
    if (looksLikeAfdPayload(v)) return v;
    return null;
  }
  if (Array.isArray(v)) {
    const lines = v.filter((x): x is string => typeof x === 'string');
    if (!lines.length) return null;
    const joined = lines.join('\n');
    if (looksLikeAfdPayload(joined)) return joined;
    if (lines.some((l) => parseAfdLine(l.trim()) != null)) return joined;
  }
  return null;
}

/** Corpo do get_afd pode ser texto AFD puro ou JSON com campo de conteúdo. */
function extractAfdFileText(text: string): string {
  const t = text.trim();
  if (!t.startsWith('{')) return text;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const keys = ['afd', 'AFD', 'data', 'file', 'content', 'nfo', 'records', 'text', 'body', 'file_afd'];
    for (const k of keys) {
      const hit = stringifyAfdFromJsonValue(j[k]);
      if (hit) return hit;
    }
    for (const v of Object.values(j)) {
      const hit = stringifyAfdFromJsonValue(v);
      if (hit) return hit;
    }
  } catch {
    /* usar texto bruto */
  }
  return text;
}

/**
 * Control iD (documentação api_idclass):
 * - Modo legado: `pis` deve ser inteiro JSON (não string); o valor é o NIS/PIS de 11 dígitos com DV válido.
 * - Modo `mode=671`: usar campo `cpf` (inteiro) com CPF de 11 dígitos do cadastro.
 * Quando o relógio **não** está em 671 no Chrono mas só há 11 dígitos no CPF: se passarem na validação de PIS,
 * tratamos como NIS e enviamos no campo `pis` (legado) — comum quem só preencheu um documento no cadastro.
 */
function resolveControlIdIdentity(
  configMode671: boolean,
  cpfDigits: string,
  pisNorm: string | null,
  pisRawSanitized: string
):
  | { ok: true; use671Api: boolean; idDigits: string }
  | { ok: false; message: string } {
  if (configMode671) {
    if (cpfDigits.length !== 11) {
      return {
        ok: false,
        message:
          'CPF com 11 dígitos é obrigatório para cadastrar no relógio (modo Portaria 671 ativo nas configurações).',
      };
    }
    return { ok: true, use671Api: true, idDigits: cpfDigits };
  }
  if (pisNorm) {
    return { ok: true, use671Api: false, idDigits: pisNorm };
  }
  if (cpfDigits.length === 11) {
    const cpfDigitsAsPis = tryNormalizeBrazilianPisTo11Digits(cpfDigits);
    if (cpfDigitsAsPis) {
      return { ok: true, use671Api: false, idDigits: cpfDigitsAsPis };
    }
    return { ok: true, use671Api: true, idDigits: cpfDigits };
  }
  if (pisRawSanitized.length > 0) {
    return {
      ok: false,
      message:
        'PIS/PASEP informado é inválido (dígitos ou dígito verificador). Corrija o cadastro, ou preencha CPF com 11 dígitos para envio em modo Portaria 671 no relógio.',
    };
  }
  return {
    ok: false,
    message:
      'Informe PIS/PASEP válido (11 dígitos com dígito verificador correto) ou CPF com 11 dígitos. ' +
      'Se o relógio usa apenas CPF (Portaria 671), marque a opção correspondente no cadastro do dispositivo e informe o CPF.',
  };
}

/** Resposta HTTP 2xx sem campo error útil = sucesso (APIs fcgi costumam devolver JSON vazio). */
function controlIdJsonIndicatesSuccess(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const err = j.error ?? j.message;
    if (err == null) return true;
    const s = String(err).trim();
    return s === '' || s === 'null';
  } catch {
    return true;
  }
}

function controlIdMessageIndicatesAlreadyRegistered(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return (
    (t.includes('já cadastrado') || t.includes('ja cadastrado')) &&
    (t.includes('pis') || t.includes('matrícula') || t.includes('matricula') || t.includes('registration'))
  );
}

/**
 * Documentação Control iD (add_users / update_users): `pis` e `cpf` são **inteiro** em JSON.
 * Enviar string (ex.: "17033259504") costuma gerar HTTP 400 «'pis' em formato incorreto».
 */
function controlIdCpfToApiInteger(digits11: string): number {
  const d = sanitizeDigits(digits11);
  if (d.length !== 11) {
    throw new Error('CPF: informe 11 dígitos numéricos para envio ao Control iD (modo 671).');
  }
  const n = parseInt(d, 10);
  if (!Number.isSafeInteger(n)) {
    throw new Error('CPF numérico fora do intervalo suportado.');
  }
  return n;
}

/** Modo legado: documentação fala em `pis` inteiro; alguns firmwares aceitam só string de 11 dígitos. */
type LegacyPisWire = 'integer' | 'string11';
/** Alguns firmwares 671 aceitam melhor CPF como string de 11 dígitos (preserva zero à esquerda). */
type Mode671CpfWire = 'integer' | 'string11';
type Mode671PisWire = 'integer' | 'string11';

/** Canonicalização tolerante (alinhada ao lado SQL/app) para extrair 11 dígitos úteis. */
function canonical11FromRaw(raw: string): string | null {
  const d = sanitizeDigits(raw);
  if (!d) return null;
  if (d.length <= 11) return d.padStart(11, '0');
  if (d.length <= 14) {
    if (d.startsWith('0')) return d.slice(1).padStart(11, '0').slice(-11);
    return d.slice(-11);
  }
  return d.slice(0, 11);
}

/** use671Api: JSON com `cpf`; senão `pis` (modo legado Control iD). */
function buildUserPayloadForAddAndUpdate(
  use671Api: boolean,
  nome: string,
  idDigits: string,
  matDigits: string,
  legacyPisWire: LegacyPisWire = 'integer',
  mode671CpfWire: Mode671CpfWire = 'integer'
): { add: Record<string, unknown>; update: Record<string, unknown> } {
  const add: Record<string, unknown> = { name: nome };
  const update: Record<string, unknown> = { name: nome };
  if (use671Api) {
    const d11 = sanitizeDigits(idDigits);
    if (d11.length !== 11) {
      throw new Error('CPF: informe 11 dígitos numéricos para envio ao Control iD (modo 671).');
    }
    if (mode671CpfWire === 'string11') {
      add.cpf = d11;
      update.cpf = d11;
    } else {
      const idNum = controlIdCpfToApiInteger(d11);
      add.cpf = idNum;
      update.cpf = idNum;
    }
  } else {
    const d11 = sanitizeDigits(idDigits);
    if (d11.length !== 11 || !validatePisPasep11(d11)) {
      throw new Error('PIS interno inválido ao montar payload Control iD.');
    }
    if (legacyPisWire === 'string11') {
      add.pis = d11;
      update.pis = d11;
    } else {
      const idNum = elevenPisDigitsToControlIdApiInteger(d11);
      add.pis = idNum;
      update.pis = idNum;
    }
  }
  if (matDigits) {
    const reg = parseInt(sanitizeDigits(matDigits), 10);
    if (!Number.isNaN(reg) && reg > 0) {
      add.registration = reg;
      update.registration = reg;
    }
  }
  return { add, update };
}

function normalizeLoadUser(u: Record<string, unknown>, _mode671: boolean): RepUserFromDevice {
  const name = typeof u.name === 'string' ? u.name : '';
  const pis = u.pis != null ? String(u.pis) : '';
  const cpf = u.cpf != null ? String(u.cpf) : '';
  const reg = u.registration != null ? String(u.registration) : '';
  return {
    nome: name,
    pis: pis || undefined,
    cpf: cpf || undefined,
    matricula: reg || undefined,
    raw: u,
  };
}

function normalizeTipo(t: string): string {
  const u = (t || 'E').toString().toUpperCase();
  if (u.startsWith('E') || u === 'IN' || u === '1') return 'E';
  if (u.startsWith('S') || u === 'OUT' || u === '2') return 'S';
  if (u.startsWith('P') || u === 'BREAK' || u === '3') return 'P';
  return u.slice(0, 1);
}

function readControlIdFcgiOnlyFlag(ex: Record<string, unknown>): boolean {
  const v = ex.controlid_use_fcgi_only;
  if (v === true) return true;
  if (typeof v === 'string') {
    const n = v.trim().toLowerCase();
    return n === 'true' || n === '1' || n === 'yes' || n === 'on';
  }
  if (typeof v === 'number') return v === 1;
  return false;
}

/** Mesma heurística do agente `controlid` — respostas heterogéneas a `load_objects`. */
function extractEventLikeRowsFromLoadObjects(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x));
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const keys = [
      'objects',
      'records',
      'logs',
      'events',
      'data',
      'transactions',
      'access_logs',
      'marcacoes',
      'access_logs_list',
      'list',
    ];
    for (const k of keys) {
      const v = o[k];
      if (Array.isArray(v)) {
        return v.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x));
      }
    }
    /** Wrappers comuns: `{ result: { … } }`, `{ body: { access_logs: … } }`. */
    const wrapKeys = ['result', 'body', 'response', 'payload', 'content', 'data'];
    for (const w of wrapKeys) {
      const inner = o[w];
      if (inner && typeof inner === 'object') {
        const hit = extractEventLikeRowsFromLoadObjects(inner);
        if (hit.length > 0) return hit;
      }
    }
  }
  return [];
}

function pickIsoTimestampFromAccessRow(row: Record<string, unknown>): string | null {
  const numericKeys = ['timestamp', 'time', 'datetime', 'date_time', 'event_time', 'unix_time', 'unixtime', 't'];
  for (const k of numericKeys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const ms = v > 10_000_000_000 ? v : v * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  const candidates = [
    row.timestamp,
    row.time,
    row.datetime,
    row.data_hora,
    row.date_time,
    row.event_time,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 8) {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function pickNsrFromAccessRow(row: Record<string, unknown>): number | null {
  const keys = [
    'nsr',
    'NSR',
    'event_nsr',
    'afd_nsr',
    'sequencia',
    'seq',
    'seq_nsr',
    'register',
    'registry',
    'log_id',
    'event_id',
    'sequencial',
    'sequential',
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
      const n = parseInt(v.trim(), 10);
      if (Number.isFinite(n) && n > 0 && n < 1_000_000_000) return n;
    }
  }
  return null;
}

function tryPis11FromDigitBlob(d: string): string | null {
  if (!d || d.length < 10) return null;
  const canon =
    tryNormalizeBrazilianPisTo11Digits(d) ?? repAfdCanonical11DigitsFromBlob(d) ?? null;
  if (canon && validatePisPasep11(canon)) return canon;
  return null;
}

/** PIS em campos conhecidos ou aninhados (objeto `user`, etc.). */
function pickValidPis11FromAccessRow(row: Record<string, unknown>, depth = 0): string | null {
  if (depth > 5) return null;
  const keys = [
    'pis',
    'nis',
    'user_pis',
    'pispasep',
    'pis_pasep',
    'cpf',
    'user_cpf',
    'document',
    'user_document',
    'enrollment',
    'codigo',
    'code',
  ];
  for (const k of keys) {
    const v = row[k];
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = pickValidPis11FromAccessRow(v as Record<string, unknown>, depth + 1);
      if (inner) return inner;
      continue;
    }
    const d = sanitizeDigits(String(v));
    const hit = tryPis11FromDigitBlob(d);
    if (hit) return hit;
  }
  for (const v of Object.values(row)) {
    if (v == null || typeof v === 'function') continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = pickValidPis11FromAccessRow(v as Record<string, unknown>, depth + 1);
      if (inner) return inner;
    } else if (typeof v === 'string' || typeof v === 'number') {
      const d = sanitizeDigits(String(v));
      if (d.length >= 11) {
        const hit = tryPis11FromDigitBlob(d);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function lookupPisBySecondWithSkew(bySecond: Map<string, string>, unixSec: number, skewSec: number): string | null {
  for (let d = -skewSec; d <= skewSec; d++) {
    const p = bySecond.get(String(unixSec + d));
    if (p && validatePisPasep11(p)) return p;
  }
  return null;
}

function lookupRegBySecondWithSkew(bySecond: Map<string, string>, unixSec: number, skewSec: number): string | null {
  for (let d = -skewSec; d <= skewSec; d++) {
    const r = bySecond.get(String(unixSec + d));
    if (r) return r;
  }
  return null;
}

/** Matrícula / registo numérico vindo do access_log (para cruzar com load_users do relógio). */
function pickRegistrationFromAccessRow(row: Record<string, unknown>): string | null {
  const keys = [
    'registration',
    'Registration',
    'matricula',
    'user_matricula',
    'badge',
    'enrollment',
    'user_enrollment',
    'employee_code',
    'codigo',
    'code',
    'matriculation',
    'user_registration',
    'registration_number',
    'cracha',
    'crachá',
  ];
  const fromObj = (o: Record<string, unknown>): string | null => {
    for (const k of keys) {
      const v = o[k];
      if (v == null) continue;
      const d = sanitizeDigits(String(v));
      if (!d) continue;
      if (d.length >= 1 && d.length <= 12) {
        const stripped = d.replace(/^0+/, '') || '0';
        if (stripped.length <= 9) return stripped;
      }
    }
    return null;
  };
  const direct = fromObj(row);
  if (direct) return direct;
  const u = row.user;
  if (u && typeof u === 'object' && !Array.isArray(u)) {
    return fromObj(u as Record<string, unknown>);
  }
  return null;
}

function normRegistrationKey(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const d = sanitizeDigits(String(raw));
  if (!d) return null;
  const stripped = d.replace(/^0+/, '') || '0';
  return stripped.length <= 9 ? stripped : null;
}

/** Mapa matrícula (relógio) → PIS 11 válido a partir de load_users. */
function buildRegToPisMapFromDeviceUsers(users: RepUserFromDevice[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of users) {
    const regRaw = (u.matricula || '').trim();
    if (!regRaw) continue;
    const rk = normRegistrationKey(regRaw);
    if (!rk) continue;
    const pisRaw = u.pis != null ? String(u.pis) : '';
    const cpfRaw = u.cpf != null ? String(u.cpf) : '';
    const d = sanitizeDigits(pisRaw || cpfRaw);
    if (!d) continue;
    const pis11 =
      tryNormalizeBrazilianPisTo11Digits(d) ?? repAfdCanonical11DigitsFromBlob(d) ?? null;
    if (pis11 && validatePisPasep11(pis11)) {
      m.set(rk, pis11);
    }
  }
  return m;
}

/**
 * PIS a partir do blob identificador da linha AFD (janelas deslizantes de 11 com DV válido).
 * 1) Se houver exactamente um PIS comum ao blob e a `load_users` do relógio, usa-o.
 * 2) Senão, se o blob tiver **uma única** substring de 11 dígitos com DV PIS válido, usa-a
 *    (firmware que concatena prefixo + NIS; `load_users` vazio ou sem PIS ainda assim recupera).
 */
function tryResolvePisFromIdentifierBlobAgainstDeviceUsers(
  rec: { raw?: string },
  devUsers: RepUserFromDevice[],
): string | null {
  const line = rec.raw;
  if (!line?.trim()) return null;
  const blob = extractAfdLineIdentifierDigitBlob(line);
  if (!blob || blob.length < 11) return null;

  const allValid = new Set<string>();
  for (let i = 0; i <= blob.length - 11; i++) {
    const w = blob.slice(i, i + 11);
    if (validatePisPasep11(w)) allValid.add(w);
  }
  if (allValid.size === 0) return null;

  const userPis = new Set<string>();
  for (const u of devUsers) {
    const d = sanitizeDigits(String(u.pis || u.cpf || ''));
    const p =
      tryNormalizeBrazilianPisTo11Digits(d) ??
      (d.length >= 11 ? repAfdCanonical11DigitsFromBlob(d) : null);
    if (p && validatePisPasep11(p)) userPis.add(p);
  }

  const intersect = [...allValid].filter((w) => userPis.has(w));
  if (intersect.length === 1) return intersect[0]!;

  if (allValid.size === 1) return [...allValid][0]!;

  return null;
}

async function fetchAllDeviceUsersCore(
  device: RepDevice,
  session: string,
  mode671: boolean
): Promise<{ users: RepUserFromDevice[]; loadError?: string }> {
  const collected: RepUserFromDevice[] = [];
  const limit = 100;
  let offset = 0;
  let first = true;
  for (;;) {
    let path = `/load_users.fcgi?session=${encodeURIComponent(session)}`;
    if (mode671) path += '&mode=671';
    const res = await deviceFetch(device, path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, offset }),
    });
    const text = await res.text();
    if (!res.ok) {
      if (first) {
        return {
          users: [],
          loadError: `load_users: HTTP ${res.status} — ${text.slice(0, 240)}`,
        };
      }
      break;
    }
    first = false;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { users: [], loadError: 'load_users: resposta não é JSON.' };
    }
    const batch = Array.isArray(data.users) ? (data.users as Record<string, unknown>[]) : [];
    for (const row of batch) {
      collected.push(normalizeLoadUser(row, mode671));
    }
    if (batch.length < limit) break;
    offset += limit;
  }
  return { users: collected };
}

/**
 * Quando o AFD trunca o campo PIS (DV inválido), o JSON de `access_logs` costuma trazer o NIS completo.
 * Índices: NSR (preferencial) e instante Unix (segundo) para casar com a marcação AFD.
 * iDClass: muitos firmwares exigem `?session=` (como no get_afd); Basic sozinho devolve vazio ou 401.
 */
async function fetchAccessLogPisLookup(device: RepDevice, session: string): Promise<{
  byNsr: Map<number, string>;
  bySecond: Map<string, string>;
  regByNsr: Map<number, string>;
  regBySecond: Map<string, string>;
}> {
  const byNsr = new Map<number, string>();
  const bySecond = new Map<string, string>();
  const regByNsr = new Map<number, string>();
  const regBySecond = new Map<string, string>();
  const ex = extra(device);
  const { login, password } = credentials(device);
  const pair = `${login}:${password}`;
  const token =
    typeof Buffer !== 'undefined'
      ? Buffer.from(pair, 'utf8').toString('base64')
      : btoa(pair);
  const bodyTemplate =
    typeof ex.load_objects_body === 'object' && ex.load_objects_body !== null && !Array.isArray(ex.load_objects_body)
      ? (ex.load_objects_body as Record<string, unknown>)
      : { object: 'access_logs' };

  const bodyVariants: Record<string, unknown>[] = [{ ...bodyTemplate }];
  if (session.trim()) {
    const withSession = { ...bodyTemplate, session: session.trim() };
    if (JSON.stringify(withSession) !== JSON.stringify(bodyVariants[0])) {
      bodyVariants.push(withSession);
    }
  }

  const paths = ['/load_objects.fcgi', '/load_objects', '/api/load_objects'];
  const sessionQs = session.trim() ? `?session=${encodeURIComponent(session.trim())}` : '';

  const mergeRowsIntoMaps = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const nsr = pickNsrFromAccessRow(row);
      const tsIso = pickIsoTimestampFromAccessRow(row);
      const sec = tsIso ? String(Math.floor(new Date(tsIso).getTime() / 1000)) : null;

      const pis = pickValidPis11FromAccessRow(row);
      if (pis) {
        if (nsr != null) byNsr.set(nsr, pis);
        if (sec) bySecond.set(sec, pis);
      }
      const reg = pickRegistrationFromAccessRow(row);
      if (reg) {
        if (nsr != null) regByNsr.set(nsr, reg);
        if (sec) regBySecond.set(sec, reg);
      }
    }
  };

  for (const path of paths) {
    for (const authMode of ['session', 'basic'] as const) {
      if (authMode === 'session' && !sessionQs) continue;
      const pathWithQs = authMode === 'session' ? `${path}${sessionQs}` : path;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      };
      if (authMode === 'basic') headers.Authorization = `Basic ${token}`;
      for (const bodyObj of bodyVariants) {
        try {
          const res = await deviceFetch(device, pathWithQs, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyObj),
          });
          if (!res.ok) continue;
          const text = await res.text();
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            continue;
          }
          const rows = extractEventLikeRowsFromLoadObjects(data);
          mergeRowsIntoMaps(rows);
          if (byNsr.size > 0 || bySecond.size > 0 || regByNsr.size > 0 || regBySecond.size > 0) {
            return { byNsr, bySecond, regByNsr, regBySecond };
          }
        } catch {
          /* próximo corpo / modo / path */
        }
      }
    }
  }
  return { byNsr, bySecond, regByNsr, regBySecond };
}

const ControlIdAdapter: RepVendorAdapter = {
  name: 'Control iD',

  async testConnection(device: RepDevice): Promise<RepConnectionTestResult> {
    if (!device.ip) {
      return { ok: false, message: 'IP não configurado' };
    }
    const logged = await controlIdLogin(device);
    if ('error' in logged) {
      return { ok: false, message: logged.error };
    }
    const path = `/get_info.fcgi?session=${encodeURIComponent(logged.session)}`;
    const res = await deviceFetch(device, path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const hint =
        typeof body === 'object' && body !== null && 'error' in (body as object)
          ? ` — ${JSON.stringify((body as Record<string, unknown>).error)}`
          : ` — ${text.slice(0, 200)}`;
      return {
        ok: false,
        message: `Control iD get_info: HTTP ${res.status}${hint}`,
        httpStatus: res.status,
        body,
      };
    }
    return {
      ok: true,
      message: 'Conexão OK (Control iD iDClass)',
      httpStatus: res.status,
      body,
    };
  },

  async pushEmployee(device: RepDevice, employee: RepEmployeePayload): Promise<{ ok: boolean; message: string }> {
    if (!device.ip) {
      return { ok: false, message: 'IP não configurado' };
    }
    const nome = (employee.nome || '').trim();
    if (!nome) {
      return { ok: false, message: 'Nome do funcionário é obrigatório.' };
    }
    const logged = await controlIdLogin(device);
    if ('error' in logged) {
      return { ok: false, message: logged.error };
    }
    const ex = extra(device);
    const configMode671 = readMode671Flag(ex);
    const cpfDigits = sanitizeDigits(employee.cpf);
    const pisOriginal = employee.pis;
    const pisRawSanitized = sanitizeDigits(employee.pis);
    const pisNorm = tryNormalizeBrazilianPisTo11Digits(pisRawSanitized);

    observabilityConsole.debug('[Control iD][pushEmployee] PIS — rastreio', {
      funcionario: nome,
      pisOriginal,
      pisSanitized: pisRawSanitized,
      pisNormalized: pisNorm,
    });

    if (pisRawSanitized.length > 0 && !pisNorm) {
      observabilityConsole.warn('[Control iD][pushEmployee] PIS inválido; não será enviado ao relógio.', {
        funcionario: nome,
        pisOriginal,
        pisSanitized: pisRawSanitized,
      });
    }

    const resolved = resolveControlIdIdentity(configMode671, cpfDigits, pisNorm, pisRawSanitized);
    if (!resolved.ok) {
      return { ok: false, message: (resolved as { ok: false; message: string }).message };
    }
    const { use671Api, idDigits } = resolved as { ok: true; use671Api: boolean; idDigits: string };

    const fonteIdentificador =
      pisNorm != null
        ? 'pis_pasep (NIS com DV válido)'
        : cpfDigits.length === 11 && !use671Api
          ? 'cpf no cadastro (mesmos 11 dígitos são NIS/PIS válido — envio legado campo pis)'
          : use671Api
            ? 'cpf (modo Portaria 671 no relógio)'
            : '—';
    const diagBase = `diag: mode_671=${configMode671 ? 'true' : 'false'}, use671Api=${resolved.ok ? ((resolved as { ok: true; use671Api: boolean }).use671Api ? 'true' : 'false') : 'n/a'}, cpf_len=${cpfDigits.length}, pis_norm=${pisNorm ? 'yes' : 'no'}`;

    const matDigits = sanitizeDigits(employee.matricula);

    /** Alguns firmwares ignoram `do_match` em REP não facial; outros exigem corpo só com `users`. */
    type UsersEnvelopeStyle = 'do_match_false' | 'users_only';

    const usersJsonBody = (users: Record<string, unknown>[], envelope: UsersEnvelopeStyle): string => {
      if (envelope === 'do_match_false') {
        return JSON.stringify({ do_match: false, users });
      }
      return JSON.stringify({ users });
    };

    const pushAttempt = async (
      use671: boolean,
      addUser: Record<string, unknown>,
      updateUser: Record<string, unknown>,
      envelope: UsersEnvelopeStyle = 'do_match_false'
    ): Promise<
      | { ok: true; message: string }
      | { ok: false; addHint: string; updHint: string }
    > => {
      let addPath = `/add_users.fcgi?session=${encodeURIComponent(logged.session)}`;
      if (use671) addPath += '&mode=671';
      const addRes = await deviceFetch(device, addPath, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: usersJsonBody([addUser], envelope),
      });
      const addText = await addRes.text();
      if (addRes.ok && controlIdJsonIndicatesSuccess(addText)) {
        return { ok: true, message: 'Funcionário cadastrado no relógio (Control iD).' };
      }

      let updPath = `/update_users.fcgi?session=${encodeURIComponent(logged.session)}`;
      if (use671) updPath += '&mode=671';
      const updRes = await deviceFetch(device, updPath, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: usersJsonBody([updateUser], envelope),
      });
      const updText = await updRes.text();
      if (updRes.ok && controlIdJsonIndicatesSuccess(updText)) {
        return { ok: true, message: 'Funcionário já estava no relógio; cadastro atualizado (Control iD).' };
      }

      // Alguns firmwares retornam 4xx/5xx para "já cadastrado" (PIS/matrícula),
      // mas o efeito prático é idempotente: o colaborador já existe no relógio.
      if (
        controlIdMessageIndicatesAlreadyRegistered(addText) &&
        controlIdMessageIndicatesAlreadyRegistered(updText)
      ) {
        return { ok: true, message: 'Funcionário já cadastrado no relógio (PIS/matrícula já existentes).' };
      }

      const addHint = addRes.ok ? addText.slice(0, 280) : `HTTP ${addRes.status} — ${addText.slice(0, 280)}`;
      const updHint = updRes.ok ? updText.slice(0, 280) : `HTTP ${updRes.status} — ${updText.slice(0, 280)}`;
      return { ok: false, addHint, updHint };
    };

    const isPisFormatRejection = (addHint: string, updHint: string): boolean => {
      const t = `${addHint}${updHint}`.toLowerCase();
      return t.includes('pis') && (t.includes('formato') || t.includes('incorrect') || t.includes('inválid'));
    };

    const hint671 =
      ' Se o relógio for Portaria 671, marque «Portaria 671» no cadastro do dispositivo no Chrono e use o CPF de 11 dígitos no funcionário.';

    if (use671Api) {
      const mode671Plan: Array<{
        wire: Mode671CpfWire;
        envelope: UsersEnvelopeStyle;
        tag: string;
        includePis?: boolean;
        pisWire?: Mode671PisWire;
      }> = [
        { wire: 'integer', envelope: 'do_match_false', tag: 'cpf inteiro + do_match:false' },
        { wire: 'string11', envelope: 'do_match_false', tag: 'cpf string 11 dígitos + do_match:false' },
        { wire: 'string11', envelope: 'users_only', tag: 'cpf string 11 dígitos (corpo só users)' },
      ];
      const pisCompat = canonical11FromRaw(pisRawSanitized);
      if (pisCompat) {
        mode671Plan.push(
          {
            wire: 'string11',
            envelope: 'do_match_false',
            tag: 'cpf string + pis string11 (compat)',
            includePis: true,
            pisWire: 'string11',
          },
          {
            wire: 'string11',
            envelope: 'users_only',
            tag: 'cpf string + pis inteiro (compat)',
            includePis: true,
            pisWire: 'integer',
          }
        );
      }
      let attempt671: { ok: true; message: string } | { ok: false; addHint: string; updHint: string } = {
        ok: false,
        addHint: '',
        updHint: '',
      };
      for (let i = 0; i < mode671Plan.length; i++) {
        const step = mode671Plan[i]!;
        let userAdd: Record<string, unknown>;
        let userUpdate: Record<string, unknown>;
        try {
          const b = buildUserPayloadForAddAndUpdate(true, nome, idDigits, matDigits, 'integer', step.wire);
          userAdd = b.add;
          userUpdate = b.update;
          if (step.includePis && pisCompat) {
            if (step.pisWire === 'integer') {
              userAdd.pis = elevenPisDigitsToControlIdApiInteger(pisCompat);
              userUpdate.pis = elevenPisDigitsToControlIdApiInteger(pisCompat);
            } else {
              userAdd.pis = pisCompat;
              userUpdate.pis = pisCompat;
            }
          }
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : 'Identificador inválido para o Control iD.' };
        }
        observabilityConsole.debug('[Control iD][pushEmployee] tentativa 671', {
          funcionario: nome,
          fonteIdentificador,
          passo: step.tag,
          identificador11: idDigits,
          valorJsonAdd: { cpf: userAdd.cpf },
        });
        attempt671 = await pushAttempt(true, userAdd, userUpdate, step.envelope);
        if (attempt671.ok) {
          if (i === 0) return attempt671;
          return {
            ok: true,
            message: `${attempt671.message} (compatibilidade Control iD: ${step.tag}).`,
          };
        }
      }
      const failed671 = attempt671 as { ok: false; addHint: string; updHint: string };
      return {
        ok: false,
        message: `Control iD: inclusão falhou (${failed671.addHint}). Atualização também falhou (${failed671.updHint}).${hint671} [${diagBase}]`,
      };
    }

    const legacyPlan: Array<{ wire: LegacyPisWire; envelope: UsersEnvelopeStyle; tag: string }> = [
      { wire: 'integer', envelope: 'do_match_false', tag: 'pis inteiro + do_match:false' },
      { wire: 'string11', envelope: 'do_match_false', tag: 'pis string 11 dígitos + do_match:false' },
      { wire: 'integer', envelope: 'users_only', tag: 'pis inteiro (corpo só users)' },
      { wire: 'string11', envelope: 'users_only', tag: 'pis string 11 dígitos (corpo só users)' },
    ];

    let attempt: { ok: true; message: string } | { ok: false; addHint: string; updHint: string } = {
      ok: false,
      addHint: '',
      updHint: '',
    };

    for (let li = 0; li < legacyPlan.length; li++) {
      const step = legacyPlan[li]!;
      let userAdd: Record<string, unknown>;
      let userUpdate: Record<string, unknown>;
      try {
        const b = buildUserPayloadForAddAndUpdate(false, nome, idDigits, matDigits, step.wire);
        userAdd = b.add;
        userUpdate = b.update;
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Identificador inválido para o Control iD.' };
      }
      observabilityConsole.debug('[Control iD][pushEmployee] tentativa legado', {
        funcionario: nome,
        fonteIdentificador,
        passo: step.tag,
        identificador11: idDigits,
        valorJsonAdd: { pis: userAdd.pis },
      });
      attempt = await pushAttempt(false, userAdd, userUpdate, step.envelope);
      if (attempt.ok) {
        if (li === 0) return attempt;
        return {
          ok: true,
          message: `${attempt.message} (compatibilidade Control iD: ${step.tag}).`,
        };
      }
    }

    const currentAttempt = attempt as { ok: false; addHint: string; updHint: string };
    if (isPisFormatRejection(currentAttempt.addHint, currentAttempt.updHint)) {
      let altAdd: Record<string, unknown>;
      let altUpd: Record<string, unknown>;
      try {
        // Retry de compatibilidade: em erro de formato do `pis`, usar CPF real do cadastro
        // no modo 671 (alguns firmwares rejeitam PIS legado mesmo com 11 dígitos).
        const cpfFor671 = cpfDigits.length === 11 ? cpfDigits : idDigits;
        const alt = buildUserPayloadForAddAndUpdate(true, nome, cpfFor671, matDigits);
        altAdd = alt.add;
        altUpd = alt.update;
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Identificador inválido para o Control iD.' };
      }
      const retry = await pushAttempt(true, altAdd, altUpd);
      if (retry.ok) {
        return {
          ok: true,
          message: `${retry.message} (compatibilidade: modo Portaria 671 + campo cpf — marque «671» no cadastro do relógio se for o caso).`,
        };
      }
      attempt = retry;
    }

    const failedAttempt = attempt as { ok: false; addHint: string; updHint: string };
    return {
      ok: false,
      message: `Control iD: inclusão falhou (${failedAttempt.addHint}). Atualização também falhou (${failedAttempt.updHint}).${hint671} [${diagBase}]`,
    };
  },

  async pullClock(device: RepDevice): Promise<{ ok: boolean; message?: string; data?: unknown }> {
    if (!device.ip) return { ok: false, message: 'IP não configurado' };
    const logged = await controlIdLogin(device);
    if ('error' in logged) return { ok: false, message: logged.error };
    const mode671 = readMode671Flag(extra(device));
    let path = `/get_system_date_time.fcgi?session=${encodeURIComponent(logged.session)}`;
    if (mode671) path += '&mode=671';
    const res = await deviceFetch(device, path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, message: `get_system_date_time: HTTP ${res.status} — ${text.slice(0, 240)}` };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: true, data: text };
    }
  },

  async pushClock(device: RepDevice, clock: RepDeviceClockSet): Promise<{ ok: boolean; message: string }> {
    if (!device.ip) return { ok: false, message: 'IP não configurado' };
    const logged = await controlIdLogin(device);
    if ('error' in logged) return { ok: false, message: logged.error };
    const mode671 = readMode671Flag(extra(device));
    const body: Record<string, unknown> = {
      day: clock.day,
      month: clock.month,
      year: clock.year,
      hour: clock.hour,
      minute: clock.minute,
      second: clock.second,
    };
    if (mode671 && clock.timezone) {
      body.timezone = clock.timezone;
    }
    let path = `/set_system_date_time.fcgi?session=${encodeURIComponent(logged.session)}`;
    if (mode671) path += '&mode=671';
    const res = await deviceFetch(device, path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, message: `set_system_date_time: HTTP ${res.status} — ${text.slice(0, 300)}` };
    }
    if (text.trim() && !controlIdJsonIndicatesSuccess(text)) {
      return { ok: false, message: text.slice(0, 300) };
    }
    return { ok: true, message: 'Data e hora gravadas no relógio (Control iD).' };
  },

  async pullDeviceInfo(device: RepDevice): Promise<{ ok: boolean; message?: string; data?: unknown }> {
    if (!device.ip) return { ok: false, message: 'IP não configurado' };
    const logged = await controlIdLogin(device);
    if ('error' in logged) return { ok: false, message: logged.error };
    const path = `/get_info.fcgi?session=${encodeURIComponent(logged.session)}`;
    const res = await deviceFetch(device, path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, message: `get_info: HTTP ${res.status} — ${text.slice(0, 240)}` };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: true, data: text };
    }
  },

  async pullUsersFromDevice(device: RepDevice): Promise<{ ok: boolean; message?: string; users: RepUserFromDevice[] }> {
    if (!device.ip) return { ok: false, message: 'IP não configurado', users: [] };
    const logged = await controlIdLogin(device);
    if ('error' in logged) return { ok: false, message: logged.error, users: [] };
    const mode671 = readMode671Flag(extra(device));
    const { users, loadError } = await fetchAllDeviceUsersCore(device, logged.session, mode671);
    if (loadError) return { ok: false, message: loadError, users: [] };
    return { ok: true, users };
  },

  async fetchPunches(device: RepDevice, since?: Date): Promise<PunchFromDevice[]> {
    if (!device.ip) return [];
    const logged = await controlIdLogin(device);
    if ('error' in logged) {
      throw new Error(logged.error);
    }
    const ex = extra(device);
    const mode671 = readMode671Flag(ex);
    const tzRaw = ex.afd_timezone ?? ex.timezone;
    const afdTz =
      typeof tzRaw === 'string' && tzRaw.trim() ? tzRaw.trim() : 'America/Sao_Paulo';
    const sessionQs = `?session=${encodeURIComponent(logged.session)}`;
    const buildPath = (use671: boolean) =>
      `/get_afd.fcgi${sessionQs}${use671 ? '&mode=671' : ''}`;

    const bodyPayload: Record<string, unknown> = {};
    const lastNsrRaw = ex.last_afd_nsr;
    let lastNsr = 0;
    if (typeof lastNsrRaw === 'number' && lastNsrRaw > 0) lastNsr = Math.floor(lastNsrRaw);
    else if (typeof lastNsrRaw === 'string' && /^\d+$/.test(lastNsrRaw.trim())) {
      lastNsr = parseInt(lastNsrRaw.trim(), 10);
      if (!Number.isFinite(lastNsr) || lastNsr < 1) lastNsr = 0;
    }
    if (lastNsr > 0) bodyPayload.initial_nsr = lastNsr;

    const doGetAfd = async (path: string, body: Record<string, unknown>) =>
      deviceFetch(device, path, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const runGetAfdOnce = async (use671: boolean, body: Record<string, unknown>) => {
      const path = buildPath(use671);
      const res = await doGetAfd(path, body);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Control iD get_afd: HTTP ${res.status} — ${text.slice(0, 280)}`);
      }
      const afdText = extractAfdFileText(text);
      return { records: parseAFD(afdText) };
    };

    /** Alguns iDClass só preenchem AFD em modo 671 (ou o inverso). */
    const modeAttempts: boolean[] = mode671 ? [true, false] : [false, true];
    let records: ReturnType<typeof parseAFD> = [];
    for (const use671 of modeAttempts) {
      const r1 = await runGetAfdOnce(use671, bodyPayload);
      records = r1.records;
      if (records.length > 0) break;
      /** `initial_nsr` à frente do último NSR devolve AFD vazio. */
      if (lastNsr > 0) {
        const r2 = await runGetAfdOnce(use671, {});
        records = r2.records;
        if (records.length > 0) break;
      }
    }
    if (since) {
      const sinceMs = since.getTime();
      const filtered = records.filter((rec) => {
        const t = wallTimeInZoneToUtcMs(rec.data, rec.hora, afdTz);
        return !Number.isNaN(t) && t > sinceMs;
      });
      /** Se o filtro eliminou tudo, mantém o lote: duplicatas são descartadas na ingestão por NSR. */
      if (filtered.length > 0) records = filtered;
    }

    let accessPisByNsr = new Map<number, string>();
    let accessPisBySecond = new Map<string, string>();
    let accessRegByNsr = new Map<number, string>();
    let accessRegBySecond = new Map<string, string>();
    if (!readControlIdFcgiOnlyFlag(ex)) {
      try {
        const lo = await fetchAccessLogPisLookup(device, logged.session);
        accessPisByNsr = lo.byNsr;
        accessPisBySecond = lo.bySecond;
        accessRegByNsr = lo.regByNsr;
        accessRegBySecond = lo.regBySecond;
      } catch {
        /* load_objects indisponível — segue só AFD */
      }
    }

    let regToPisFromDevice = new Map<string, string>();
    let devUsersSnapshot: RepUserFromDevice[] = [];
    /** Sempre que há AFD: precisamos de `load_users` para cruzar matrícula e heurística de blob (PIS “válido” no AFD pode estar errado). */
    if (records.length > 0) {
      const { users: devUsers, loadError } = await fetchAllDeviceUsersCore(device, logged.session, mode671);
      if (!loadError && devUsers.length > 0) {
        devUsersSnapshot = devUsers;
        regToPisFromDevice = buildRegToPisMapFromDeviceUsers(devUsers);
      }
    }

    if (records.length === 0) {
      observabilityConsole.warn('[Control iD][fetchPunches] AFD sem registros parseados após get_afd.', {
        deviceId: device.id,
        mode671Config: mode671,
        last_afd_nsr: lastNsr || undefined,
        timezone: afdTz,
      });
    }
    return records.map((rec) => {
      let id11 = normalizeDocument(rec.cpfOuPis).padStart(11, '0').slice(0, 11);
      const tms = wallTimeInZoneToUtcMs(rec.data, rec.hora, afdTz);
      const unixSec = !Number.isNaN(tms) ? Math.floor(tms / 1000) : NaN;
      const regHint =
        accessRegByNsr.get(rec.nsr) ??
        (Number.isFinite(unixSec) ? lookupRegBySecondWithSkew(accessRegBySecond, unixSec, 420) : null);
      const regKey = normRegistrationKey(regHint);

      /**
       * Ordem de confiança (Control iD):
       * 1) Matrícula/registo no access_log + PIS em load_users (cruzamento) — vence AFD e campos PIS espúrios no JSON.
       * 2) PIS explícito no access_log (NSR, depois instante ± skew).
       * 3) Blob identificador AFD: uma única janela PIS que coincide com utilizadores do relógio.
       * 4) PIS canónico do AFD.
       */
      let resolvedByReg = false;
      if (regKey && regToPisFromDevice.has(regKey)) {
        id11 = regToPisFromDevice.get(regKey)!;
        resolvedByReg = true;
      } else {
        const fromNsr = accessPisByNsr.get(rec.nsr);
        const fromSec =
          Number.isFinite(unixSec) ? lookupPisBySecondWithSkew(accessPisBySecond, unixSec, 420) : null;
        const accessAlt =
          fromNsr && validatePisPasep11(fromNsr)
            ? fromNsr
            : fromSec && validatePisPasep11(fromSec)
              ? fromSec
              : null;
        if (accessAlt) id11 = accessAlt;
      }
      if (!resolvedByReg) {
        const fromBlob = tryResolvePisFromIdentifierBlobAgainstDeviceUsers(rec, devUsersSnapshot);
        if (fromBlob) id11 = fromBlob;
      }

      const recMerged = { ...rec, cpfOuPis: id11 };
      const badgeFromPis = matriculaFromAfdPisField(id11);
      /** Com PIS truncado/inválido no AFD, a matrícula do access_log / load_users ainda casa no espelho — não exigir DV válido no id11. */
      const badgeMat: string | null = badgeFromPis ?? (regKey && String(regKey).trim() !== '' ? regKey : null);
      return {
        pis: id11,
        cpf: id11,
        matricula: badgeMat,
        data_hora: afdRecordWallTimeToUtcIso(rec, afdTz),
        tipo: normalizeTipo(rec.tipo),
        nsr: rec.nsr,
        raw: { ...recMerged, source: 'controlid_afd', matricula_derived: badgeMat ?? null },
      };
    });
  },
};

export default ControlIdAdapter;
