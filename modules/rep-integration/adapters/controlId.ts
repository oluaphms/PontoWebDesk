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
} from '../repParser';
import {
  sanitizeDigits,
  tryNormalizeBrazilianPisTo11Digits,
  elevenPisDigitsToControlIdApiInteger,
  validatePisPasep11,
} from '../pisPasep';

function extra(device: RepDevice): Record<string, unknown> {
  return device.config_extra && typeof device.config_extra === 'object'
    ? (device.config_extra as Record<string, unknown>)
    : {};
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
    console.debug('[Control iD][login] usuário (tamanho)', login.length, '| senha (tamanho)', password.length);
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

/** use671Api: JSON com `cpf`; senão `pis` (modo legado Control iD). */
function buildUserPayloadForAddAndUpdate(
  use671Api: boolean,
  nome: string,
  idDigits: string,
  matDigits: string,
  legacyPisWire: LegacyPisWire = 'integer'
): { add: Record<string, unknown>; update: Record<string, unknown> } {
  const add: Record<string, unknown> = { name: nome };
  const update: Record<string, unknown> = { name: nome };
  if (use671Api) {
    const idNum = controlIdCpfToApiInteger(idDigits);
    add.cpf = idNum;
    update.cpf = idNum;
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
    const configMode671 = ex.mode_671 === true;
    const cpfDigits = sanitizeDigits(employee.cpf);
    const pisOriginal = employee.pis;
    const pisRawSanitized = sanitizeDigits(employee.pis);
    const pisNorm = tryNormalizeBrazilianPisTo11Digits(pisRawSanitized);

    console.debug('[Control iD][pushEmployee] PIS — rastreio', {
      funcionario: nome,
      pisOriginal,
      pisSanitized: pisRawSanitized,
      pisNormalized: pisNorm,
    });

    if (pisRawSanitized.length > 0 && !pisNorm) {
      console.warn('[Control iD][pushEmployee] PIS inválido; não será enviado ao relógio.', {
        funcionario: nome,
        pisOriginal,
        pisSanitized: pisRawSanitized,
      });
    }

    const resolved = resolveControlIdIdentity(configMode671, cpfDigits, pisNorm, pisRawSanitized);
    if (!resolved.ok) {
      return { ok: false, message: resolved.message };
    }
    const { use671Api, idDigits } = resolved;

    const fonteIdentificador =
      pisNorm != null
        ? 'pis_pasep (NIS com DV válido)'
        : cpfDigits.length === 11 && !use671Api
          ? 'cpf no cadastro (mesmos 11 dígitos são NIS/PIS válido — envio legado campo pis)'
          : use671Api
            ? 'cpf (modo Portaria 671 no relógio)'
            : '—';

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
      let userAdd: Record<string, unknown>;
      let userUpdate: Record<string, unknown>;
      try {
        const b = buildUserPayloadForAddAndUpdate(true, nome, idDigits, matDigits);
        userAdd = b.add;
        userUpdate = b.update;
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Identificador inválido para o Control iD.' };
      }
      console.debug('[Control iD][pushEmployee] payload 671', {
        funcionario: nome,
        fonteIdentificador,
        valorJsonAdd: { cpf: userAdd.cpf },
      });
      const attempt671 = await pushAttempt(true, userAdd, userUpdate);
      if (attempt671.ok) return attempt671;
      return {
        ok: false,
        message: `Control iD: inclusão falhou (${attempt671.addHint}). Atualização também falhou (${attempt671.updHint}).${hint671}`,
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
      console.debug('[Control iD][pushEmployee] tentativa legado', {
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

    if (!attempt.ok && isPisFormatRejection(attempt.addHint, attempt.updHint)) {
      let altAdd: Record<string, unknown>;
      let altUpd: Record<string, unknown>;
      try {
        const alt = buildUserPayloadForAddAndUpdate(true, nome, idDigits, matDigits);
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

    return {
      ok: false,
      message: `Control iD: inclusão falhou (${!attempt.ok ? attempt.addHint : ''}).` +
        ` Atualização também falhou (${!attempt.ok ? attempt.updHint : ''}).${hint671}`,
    };
  },

  async pullClock(device: RepDevice): Promise<{ ok: boolean; message?: string; data?: unknown }> {
    if (!device.ip) return { ok: false, message: 'IP não configurado' };
    const logged = await controlIdLogin(device);
    if ('error' in logged) return { ok: false, message: logged.error };
    const mode671 = extra(device).mode_671 === true;
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
    const mode671 = extra(device).mode_671 === true;
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
    const collected: RepUserFromDevice[] = [];
    if (!device.ip) return { ok: false, message: 'IP não configurado', users: [] };
    const logged = await controlIdLogin(device);
    if ('error' in logged) return { ok: false, message: logged.error, users: [] };
    const mode671 = extra(device).mode_671 === true;
    const limit = 100;
    let offset = 0;
    for (;;) {
      let path = `/load_users.fcgi?session=${encodeURIComponent(logged.session)}`;
      if (mode671) path += '&mode=671';
      const res = await deviceFetch(device, path, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, offset }),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          message: `load_users: HTTP ${res.status} — ${text.slice(0, 240)}`,
          users: collected,
        };
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { ok: false, message: 'load_users: resposta não é JSON.', users: collected };
      }
      const batch = Array.isArray(data.users) ? (data.users as Record<string, unknown>[]) : [];
      for (const row of batch) {
        collected.push(normalizeLoadUser(row, mode671));
      }
      if (batch.length < limit) break;
      offset += limit;
    }
    return { ok: true, users: collected };
  },

  async fetchPunches(device: RepDevice, since?: Date): Promise<PunchFromDevice[]> {
    if (!device.ip) return [];
    const logged = await controlIdLogin(device);
    if ('error' in logged) {
      throw new Error(logged.error);
    }
    const ex = extra(device);
    const mode671 = ex.mode_671 === true;
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
    if (records.length === 0) {
      console.warn('[Control iD][fetchPunches] AFD sem registros parseados após get_afd.', {
        deviceId: device.id,
        mode671Config: mode671,
        last_afd_nsr: lastNsr || undefined,
        timezone: afdTz,
      });
    }
    return records.map((rec) => {
      const badgeMat = matriculaFromAfdPisField(rec.cpfOuPis);
      return {
        pis: rec.cpfOuPis,
        cpf: rec.cpfOuPis,
        matricula: badgeMat,
        data_hora: afdRecordWallTimeToUtcIso(rec, afdTz),
        tipo: normalizeTipo(rec.tipo),
        nsr: rec.nsr,
        raw: { ...rec, source: 'controlid_afd', matricula_derived: badgeMat ?? null },
      };
    });
  },
};

export default ControlIdAdapter;
