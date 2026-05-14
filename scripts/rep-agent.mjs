#!/usr/bin/env node
/**
 * Agente local (rede da empresa): lê o relógio na LAN e envia marcações ao SaaS.
 * Fluxo: Relógio → este script → POST https://seu-app.vercel.app/api/rep/punch → Supabase
 *
 * Dispositivos Control iD (idClass): o endpoint /api/punches exige POST com JSON e comando
 * explícito (GET ou POST vazio retorna "Bad Request: POST expected" / "Invalid command: none").
 *
 * Suporta dois modos de coleta:
 *   1) API direta (Control iD JSON) — pipeline padrão (inalterado).
 *   2) AFD (Portaria 1510, formato simplificado NSR+DATA+HORA+PIS) — fallback automático
 *      quando o dispositivo responde "Invalid command: none" em todos os comandos,
 *      ou quando REP_MODE=AFD é informado explicitamente.
 *
 * Variáveis de ambiente:
 *   REP_SAAS_URL        URL base do app (ex: https://pontowebdesk.vercel.app).
 *                       Se vazio, usa VITE_APP_URL (ex.: http://localhost:3010 com Vite + proxy /api).
 *   API_KEY             Mesma chave das APIs serverless (Authorization: Bearer)
 *   REP_DEVICE_IP       IP do relógio (ex: 192.168.0.38)
 *   REP_DEVICE_SCHEME   Protocolo do relógio: http|https (default: http)
 *   REP_DEVICE_PORT     Porta (default: 80 em http, 443 em https, se omitida)
 *   REP_INSECURE_TLS    Aceita certificado self-signed no relógio (1/true) — usar só em rede interna
 *                       (também aplicado ao HTTPS após redirect 301/302 a partir de http://IP)
 *   REP_COMPANY_ID      UUID da empresa (public.companies ou tenant)
 *   REP_DEVICE_ID       (opcional) UUID do rep_devices cadastrado no painel
 *   REP_DEVICE_SESSION  (opcional) token de sessão — enviado junto a comandos em firmwares que exigem
 *   REP_DEVICE_BEARER ou REP_DEVICE_AUTH_TOKEN (opcional) Authorization no relógio (ex.: Bearer ...)
 *   REP_DEVICE_LOGIN      Utilizador login.fcgi (default admin). MODO PRODUÇÃO idClass.
 *   REP_DEVICE_PASSWORD   Palavra-passe do relógio (login.fcgi + get_afd.fcgi). Nunca logada.
 *   REP_DEVICE_CONTROLID_FCGI  "1" — tenta primeiro AFD por .fcgi mesmo sem palavra-passe (requer REP_DEVICE_SESSION).
 *   REP_AFD_PORTARIA_671    "1" — pede AFD no formato Portaria 671 (query mode=671 em get_afd.fcgi).
 *
 *   --- modo AFD ---
 *   REP_MODE                    Quando "AFD", força ingestão por arquivo AFD sem tentar a API direta.
 *   REP_AFD_PATH                (opcional) Caminho prioritário do AFD no dispositivo (ex.: /afd).
 *   REP_AFD_TIMEOUT_MS          Timeout por tentativa de download (default 20000).
 *   REP_AFD_RETRY               Número de tentativas por rota (default 3).
 *   REP_AFD_MAX_BYTES           Limite de tamanho do arquivo AFD (default 10 MiB).
 *   REP_AFD_CACHE_FILE          Caminho do cache local de NSRs já enviados (default data/rep-agent/processed-nsr.json).
 *   REP_LAST_NSR_FILE           Caminho do controle de último NSR por dispositivo (default data/rep-agent/last-nsr.json).
 *   REP_DEVICE_TIMEZONE_OFFSET  Offset do horário local do relógio (default -03:00). Aplicado ao data_hora do AFD.
 *
 *   --- loop / serviço ---
 *   REP_AGENT_LOOP        "1" (default) executa em loop contínuo; "0" roda um único ciclo.
 *   REP_AGENT_INTERVAL_MS Intervalo entre ciclos quando em loop (default 60000 = 1 min).
 *   REP_AGENT_SKIP_DOTENV "1" — não lê .env / .env.local (útil se o ficheiro tiver mock 127.0.0.1:8181
 *                         e quiser usar só variáveis definidas no PowerShell antes de npm run).
 *   Flag CLI: --once      Equivalente a REP_AGENT_LOOP=0.
 *
 * Uso: npm run rep:agent
 */

import { readFileSync, existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/** Preenche process.env a partir de `.env` e `.env.local` na cwd (não sobrescreve variáveis já definidas no shell). */
function loadEnvFilesFromProjectRoot() {
  const root = process.cwd();
  const merged = {};
  for (const name of ['.env', '.env.local']) {
    const p = path.join(root, name);
    if (!existsSync(p)) continue;
    try {
      Object.assign(merged, dotenv.parse(readFileSync(p, 'utf8')));
    } catch {
      // ignora ficheiro ilegível
    }
  }
  for (const [k, v] of Object.entries(merged)) {
    const cur = process.env[k];
    if (cur === undefined || cur === '') {
      process.env[k] = String(v ?? '');
    }
  }
}

const repAgentSkipDotenv = /^(1|true|yes)$/i.test((process.env.REP_AGENT_SKIP_DOTENV || '').trim());
if (!repAgentSkipDotenv) {
  loadEnvFilesFromProjectRoot();
} else {
  console.warn(
    '[rep-agent] REP_AGENT_SKIP_DOTENV=1 — .env e .env.local ignorados (apenas variáveis já no ambiente do processo).'
  );
}

function trimBaseUrl(s) {
  return String(s ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/** SaaS onde existe POST /api/rep/punch: REP_SAAS_URL, ou VITE_APP_URL (dev com Vite na mesma origem). */
const saas = trimBaseUrl(process.env.REP_SAAS_URL) || trimBaseUrl(process.env.VITE_APP_URL) || '';
const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
const ip = (process.env.REP_DEVICE_IP || '').trim();
const scheme = (process.env.REP_DEVICE_SCHEME || 'http').trim().toLowerCase() === 'https' ? 'https' : 'http';
/** Porta padrão coerente com o esquema (evita https + 80 por engano quando REP_DEVICE_PORT não está no .env). */
const defaultDevicePort = scheme === 'https' ? '443' : '80';
const port = (process.env.REP_DEVICE_PORT || defaultDevicePort).trim();
const companyId = (process.env.REP_COMPANY_ID || '').trim();
const deviceId = (process.env.REP_DEVICE_ID || '').trim() || undefined;
const insecureTls = /^(1|true|yes)$/i.test((process.env.REP_INSECURE_TLS || '').trim());
/** Sessão API Control iD (.fcgi); ou obtida via login com REP_DEVICE_PASSWORD. */
const repDeviceSession = (process.env.REP_DEVICE_SESSION || '').trim();
const repDevicePassword = (process.env.REP_DEVICE_PASSWORD || '').trim();
const repDeviceControlIdFcgi = /^(1|true|yes)$/i.test(
  (process.env.REP_DEVICE_CONTROLID_FCGI || process.env.REP_DEVICE_USE_CONTROLID || '').trim()
);
const repAfdPortaria671 = /^(1|true|yes|671)$/i.test((process.env.REP_AFD_PORTARIA_671 || '').trim());

const repModeEnv = (process.env.REP_MODE || '').trim().toUpperCase();
const repAfdPathEnv = (process.env.REP_AFD_PATH || '').trim();
const REP_AFD_TIMEOUT_MS = Math.max(1000, parseInt(process.env.REP_AFD_TIMEOUT_MS || '20000', 10) || 20000);
const REP_AFD_RETRY = Math.max(1, parseInt(process.env.REP_AFD_RETRY || '3', 10) || 3);
const REP_AFD_MAX_BYTES = Math.max(
  64 * 1024,
  parseInt(process.env.REP_AFD_MAX_BYTES || `${10 * 1024 * 1024}`, 10) || 10 * 1024 * 1024
);
const REP_AFD_CACHE_FILE = path.resolve(
  process.env.REP_AFD_CACHE_FILE || 'data/rep-agent/processed-nsr.json'
);
const REP_LAST_NSR_FILE = path.resolve(
  process.env.REP_LAST_NSR_FILE || 'data/rep-agent/last-nsr.json'
);
const REP_DEVICE_TIMEZONE_OFFSET = (process.env.REP_DEVICE_TIMEZONE_OFFSET || '-03:00').trim();
const REP_AGENT_LOOP = !/^(0|false|no|off)$/i.test((process.env.REP_AGENT_LOOP || '1').trim());
const REP_AGENT_INTERVAL_MS = Math.max(
  5000,
  parseInt(process.env.REP_AGENT_INTERVAL_MS || '60000', 10) || 60000
);
const CLI_ONCE = process.argv.slice(2).some((a) => a === '--once');

const TZ_OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;
if (!TZ_OFFSET_RE.test(REP_DEVICE_TIMEZONE_OFFSET)) {
  console.error(
    `[rep-agent] REP_DEVICE_TIMEZONE_OFFSET inválido: "${REP_DEVICE_TIMEZONE_OFFSET}" (esperado +HH:MM ou -HH:MM)`
  );
  process.exit(1);
}

if (scheme === 'https' && insecureTls) {
  // Uso restrito a LAN confiável: aceita certificado self-signed do relógio.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function fail(msg) {
  console.error(`[rep-agent] ${msg}`);
  process.exit(1);
}

if (!saas) {
  fail(
    'Defina REP_SAAS_URL ou VITE_APP_URL no .env / .env.local (carregados automaticamente). Ex.: REP_SAAS_URL=https://seu-app.vercel.app ou VITE_APP_URL=http://localhost:3010 com o Vite a correr. Em PowerShell: $env:REP_SAAS_URL="https://..." Se .env.local apontar para localhost e quiser usar só variáveis do shell: $env:REP_AGENT_SKIP_DOTENV="1"'
  );
}
if (!apiKey) fail('Defina API_KEY (ou REP_API_KEY) no .env / .env.local ou no ambiente.');
if (!ip) {
  fail(
    'Defina REP_DEVICE_IP no .env / .env.local (ex.: 192.168.x.x do relógio) ou 127.0.0.1 com scripts/rep-agent-mock.mjs (porta 8181). PowerShell: $env:REP_DEVICE_IP="127.0.0.1"'
  );
}
if (!companyId) {
  fail(
    'Defina REP_COMPANY_ID no .env / .env.local (UUID em public.companies). PowerShell: $env:REP_COMPANY_ID="..."'
  );
}

{
  const keyHint =
    apiKey.length > 10 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-3)}` : apiKey.length > 0 ? '(definida)' : '';
  console.log(
    '[rep-agent] Config efetiva:',
    `relógio=${scheme}://${ip}:${port}`,
    `| SaaS=${saas}`,
    `| empresa=${companyId.slice(0, 8)}…`,
    `| API_KEY=${keyHint}`,
    repAgentSkipDotenv ? '| dotenv=off' : '| dotenv=on',
    repDevicePassword || repDeviceSession
      ? `| relógio API=${repDeviceSession ? 'sessão' : 'login.fcgi'}`
      : repDeviceControlIdFcgi
        ? '| relógio API=controlid_fcgi (falta sessão ou REP_DEVICE_PASSWORD)'
        : ''
  );
}

function normalizeTipo(t) {
  const u = String(t || 'E').toUpperCase();
  if (u.startsWith('E') || u === 'IN' || u === '1') return 'E';
  if (u.startsWith('S') || u === 'OUT' || u === '2') return 'S';
  if (u.startsWith('P') || u === 'BREAK' || u === '3') return 'P';
  return u.slice(0, 1);
}

function pickDataHora(p) {
  const v = p.timestamp ?? p.data_hora ?? p.datetime;
  return v ? new Date(v).toISOString() : null;
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clockDeviceAuthHeaders() {
  const deviceBearer = (process.env.REP_DEVICE_BEARER || process.env.REP_DEVICE_AUTH_TOKEN || '').trim();
  const h = {};
  if (deviceBearer) {
    h.Authorization = deviceBearer.startsWith('Bearer ') ? deviceBearer : `Bearer ${deviceBearer}`;
  }
  return h;
}

/** Host da URL é o mesmo relógio configurado em REP_DEVICE_IP (IPv4 ou hostname; IPv6 entre []). */
function isConfiguredDeviceHost(hostname) {
  const raw = String(hostname || '').toLowerCase();
  const h = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const target = String(ip || '').toLowerCase();
  return Boolean(target) && h === target;
}

/** TLS: aceita self-signed só em HTTPS para o host do relógio quando REP_INSECURE_TLS=1. */
function clockTlsRejectUnauthorized(urlObj) {
  if (urlObj.protocol !== 'https:') return true;
  return !(insecureTls && isConfiguredDeviceHost(urlObj.hostname));
}

const CLOCK_HTTP_MAX_REDIRECTS = 8;
const CLOCK_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function clockNextUrlFromRedirect(currentUrl, locationHeader) {
  if (!locationHeader) return null;
  try {
    const next = new URL(String(locationHeader).trim(), currentUrl).href;
    return next === currentUrl ? null : next;
  } catch {
    return null;
  }
}

/** POST cru ao relógio (uma ida); devolve cabeçalhos para seguir Location em redirects. */
async function clockRawPost(urlString, bodyUtf8, headerFields) {
  const u = new URL(urlString);
  const useHttps = u.protocol === 'https:';
  const { request } = await (useHttps ? import('node:https') : import('node:http'));
  const headers = {
    ...headerFields,
    'Content-Length': Buffer.byteLength(bodyUtf8, 'utf8'),
  };
  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (useHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers,
        rejectUnauthorized: clockTlsRejectUnauthorized(u),
        insecureHTTPParser: true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, text, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    req.write(bodyUtf8);
    req.end();
  });
}

/** POST JSON para o relógio (parser tolerante a respostas HTTP não padrão + TLS opcional + redirects). */
async function clockPostJson(url, payload) {
  const body = JSON.stringify(payload);
  const headerFields = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    ...clockDeviceAuthHeaders(),
  };
  let current = url;
  let last = { status: 0, text: '' };
  for (let d = 0; d <= CLOCK_HTTP_MAX_REDIRECTS; d += 1) {
    last = await clockRawPost(current, body, headerFields);
    const st = last.status;
    if (CLOCK_REDIRECT_STATUSES.has(st)) {
      const loc = last.headers?.location;
      const next = clockNextUrlFromRedirect(current, loc);
      if (next) {
        current = next;
        continue;
      }
    }
    return { status: st, text: last.text };
  }
  return { status: last.status, text: last.text };
}

/** POST para get_afd.fcgi — resposta costuma ser text/plain ou octet-stream (corpo AFD bruto). */
async function clockPostAfdBinary(url, payload) {
  const body = JSON.stringify(payload ?? {});
  const headerFields = {
    Accept: 'text/plain, application/octet-stream, application/json, */*',
    'Content-Type': 'application/json',
    ...clockDeviceAuthHeaders(),
  };
  let current = url;
  let last = { status: 0, text: '' };
  for (let d = 0; d <= CLOCK_HTTP_MAX_REDIRECTS; d += 1) {
    last = await clockRawPost(current, body, headerFields);
    const st = last.status;
    if (CLOCK_REDIRECT_STATUSES.has(st)) {
      const next = clockNextUrlFromRedirect(current, last.headers?.location);
      if (next) {
        current = next;
        continue;
      }
    }
    return { status: st, text: last.text };
  }
  return { status: last.status, text: last.text };
}

/** GET genérico para o relógio com timeout e limite de tamanho (usado pelo modo AFD). Segue redirects. */
async function clockGet(url, { timeoutMs = REP_AFD_TIMEOUT_MS, maxBytes = REP_AFD_MAX_BYTES } = {}) {
  let current = url;
  let last = { status: 0, text: '', contentType: '' };

  for (let d = 0; d <= CLOCK_HTTP_MAX_REDIRECTS; d += 1) {
    const u = new URL(current);
    const useHttps = u.protocol === 'https:';
    const { request } = await (useHttps ? import('node:https') : import('node:http'));
    const headers = {
      Accept: 'text/plain, application/octet-stream, */*',
      ...clockDeviceAuthHeaders(),
    };

    const one = await new Promise((resolve, reject) => {
      let aborted = false;
      let received = 0;
      const chunks = [];
      const req = request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (useHttps ? 443 : 80),
          path: `${u.pathname}${u.search}`,
          method: 'GET',
          headers,
          rejectUnauthorized: clockTlsRejectUnauthorized(u),
          insecureHTTPParser: true,
        },
        (res) => {
          res.on('data', (c) => {
            if (aborted) return;
            const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
            received += buf.length;
            if (received > maxBytes) {
              aborted = true;
              try {
                res.destroy();
                req.destroy();
              } catch {
                /* noop */
              }
              reject(new Error(`Arquivo excedeu limite de ${maxBytes} bytes em ${current}`));
              return;
            }
            chunks.push(buf);
          });
          res.on('end', () => {
            if (aborted) return;
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode || 0,
              text,
              contentType: String(res.headers['content-type'] || ''),
              headers: res.headers,
            });
          });
          res.on('error', (err) => {
            if (aborted) return;
            aborted = true;
            reject(err);
          });
        }
      );
      req.setTimeout(timeoutMs, () => {
        if (aborted) return;
        aborted = true;
        try {
          req.destroy();
        } catch {
          /* noop */
        }
        reject(new Error(`Timeout (${timeoutMs}ms) em GET ${current}`));
      });
      req.on('error', (err) => {
        if (aborted) return;
        aborted = true;
        reject(err);
      });
      req.end();
    });

    last = { status: one.status, text: one.text, contentType: one.contentType };
    if (CLOCK_REDIRECT_STATUSES.has(one.status)) {
      const next = clockNextUrlFromRedirect(current, one.headers?.location);
      if (next) {
        current = next;
        continue;
      }
    }
    return last;
  }

  return last;
}

/** Caminhos comuns (Control iD / clones / firmwares legados). */
const DEVICE_ENDPOINT_PATHS = [
  '/api/punches',
  '/api/v1/punches',
  '/api/punchlog',
  '/api/load_punchlog',
  '/api/logs',
  '/api/get_log',
];

/** Rotas comuns para download do AFD em REPs/clones (GET). idClass: primeiro POST get_afd.fcgi com sessão (tryAfdControlIdSessionDownload). */
const AFD_DOWNLOAD_PATHS = ['/afd', '/rep/afd', '/download/afd', '/api/afd', '/files/afd'];

function buildCommandPayloads() {
  const session = repDeviceSession;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
  const todayEnd = new Date().toISOString();

  const basePayloads = [
    { command: 'get_punches' },
    { cmd: 'punchlog' },
    { object: 'punch', action: 'get' },
  ];

  const payloadsWithFilters = [
    {
      command: 'get_punches',
      from: todayStart,
      to: todayEnd,
    },
    {
      cmd: 'punchlog',
      start: 0,
      limit: 100,
    },
    {
      object: 'punch',
      action: 'get',
      offset: 0,
      limit: 100,
    },
  ];

  const withSession = (p) => ({ ...p, session });

  /** Ordem: com sessão → simples → com filtro (sessão + sem) → {} último recurso */
  const out = [];
  if (session) {
    for (const p of basePayloads) {
      out.push(withSession(p));
    }
  }
  for (const p of basePayloads) {
    out.push(p);
  }
  if (session) {
    for (const p of payloadsWithFilters) {
      out.push(withSession(p));
    }
  }
  for (const p of payloadsWithFilters) {
    out.push(p);
  }
  out.push({});
  return out;
}

function deviceResponseHasError(data) {
  if (data == null) return true;
  if (Array.isArray(data)) return false;
  if (typeof data !== 'object') return true;
  if ('error' in data && data.error != null && data.error !== '') return true;
  if (data.success === false) return true;
  if (typeof data.code === 'number' && data.code >= 400) return true;
  return false;
}

function isInvalidCommandNoneResponse(data) {
  if (!data || typeof data !== 'object') return false;
  const err = String(data.error || '').toLowerCase();
  return err.includes('invalid command') && err.includes('none');
}

function extractPunchListFromDeviceResponse(data) {
  if (data == null) return null;
  if (Array.isArray(data)) return data;
  const tryObject = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) return obj;
    for (const key of ['punches', 'records', 'punchlog', 'punchs', 'events', 'log', 'result']) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    return null;
  };
  const nested = data.data;
  if (Array.isArray(nested)) return nested;
  if (nested && typeof nested === 'object') {
    const inner = tryObject(nested);
    if (inner) return inner;
  }
  for (const key of ['response', 'result', 'payload']) {
    const block = data[key];
    if (Array.isArray(block)) return block;
    if (block && typeof block === 'object') {
      const inner = tryObject(block);
      if (inner) return inner;
    }
  }
  for (const key of ['punches', 'records', 'punchlog', 'punchs', 'events', 'data']) {
    const v = data[key];
    if (Array.isArray(v)) return v;
  }
  return null;
}

async function fetchPunchesFromClock() {
  const base = `${scheme}://${ip}:${port}`;
  const paths = DEVICE_ENDPOINT_PATHS;
  const payloads = buildCommandPayloads();
  let lastErr = null;
  let attempts = 0;
  let invalidCommandHits = 0;
  let connectionRefusedHits = 0;

  for (const path of paths) {
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    for (const payload of payloads) {
      attempts += 1;
      try {
        console.log('[REP PAYLOAD TESTADO]', payload);
        const res = await clockPostJson(url, payload);
        const text = res.text || '';
        const data = parseJsonSafe(text);

        if (data != null) {
          console.log('[REP RAW RESPONSE]', data);
          if (isInvalidCommandNoneResponse(data)) {
            invalidCommandHits += 1;
          }
        } else if (text) {
          console.log('[REP RAW TEXT]', text.length > 8000 ? `${text.slice(0, 8000)}…` : text);
        }

        const okHttp = res.status >= 200 && res.status < 300;
        if (!okHttp) {
          lastErr = new Error(`HTTP ${res.status} em ${url}`);
          continue;
        }
        if (data == null) {
          lastErr = new Error(`Resposta não-JSON em ${url}`);
          continue;
        }
        if (deviceResponseHasError(data)) {
          lastErr = new Error(data.error || data.message || `Resposta com erro do dispositivo em ${url}`);
          continue;
        }

        const list = extractPunchListFromDeviceResponse(data);
        if (list != null) {
          return { list, url, attempts, invalidCommandHits };
        }
        lastErr = new Error(`Formato de lista de batidas não reconhecido em ${url}`);
      } catch (e) {
        lastErr = e;
        if (e && e.code === 'ECONNREFUSED') connectionRefusedHits += 1;
        console.error('[REP ERROR]', e?.message || String(e));
      }
    }
  }

  if (lastErr) {
    console.error('[rep-agent] Último erro antes do fallback esgotado:', lastErr.message || lastErr);
  }

  if (attempts > 0 && invalidCommandHits === 0 && connectionRefusedHits === attempts) {
    const mockHint =
      ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
        ? ' Noutro terminal na raiz do projeto: node scripts\\rep-agent-mock.mjs (porta ' +
          port +
          '; ou ajuste REP_DEVICE_IP / REP_DEVICE_PORT se o mock usar outra).'
        : ' Verifique se o relógio está ligado, na mesma rede, e se IP/porta estão corretos.';
    const err = new Error(`ECONNREFUSED — ninguém responde em ${base} (${attempts} tentativas).${mockHint}`);
    err.attempts = attempts;
    err.invalidCommandHits = 0;
    err.connectionRefusedAll = true;
    throw err;
  }

  const err = new Error('Nenhum comando compatível com o dispositivo');
  err.attempts = attempts;
  err.invalidCommandHits = invalidCommandHits;
  if (lastErr && typeof lastErr.message === 'string') {
    err.lastUnderlyingMessage = lastErr.message;
  }
  throw err;
}

async function postPunch(body) {
  const res = await fetch(`${saas}/api/rep/punch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const hint =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.detail === 'string'
          ? data.detail
          : '';
    const bodyErr = [data?.error, data?.code, hint].filter(Boolean).join(' | ');
    const snippet = (text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    console.error(`[REP PUNCH HTTP] status=${res.status}`, bodyErr || snippet || '(sem corpo)');
    throw new Error(bodyErr || snippet || `HTTP ${res.status}`);
  }
  return data;
}

// ============================================================================
// Modo AFD — coleta por arquivo (fallback / forçado por REP_MODE=AFD)
// ============================================================================

/** Conteúdo parece ficheiro AFD (linhas numéricas), não JSON de erro nem HTML. */
function isPlausibleAfdText(content) {
  if (!content || typeof content !== 'string') return false;
  const t = content.trim();
  if (t.length < 16) return false;
  const head = t.slice(0, 256).toLowerCase();
  if (head.includes('<html') || head.includes('<!doctype')) return false;
  const asJson = parseJsonSafe(t);
  if (asJson && typeof asJson === 'object' && !Array.isArray(asJson)) {
    if (asJson.error != null && asJson.error !== '') return false;
    if (asJson.code != null && asJson.code !== '') return false;
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^\d{20,}$/.test(line)) return true;
    if (line.length === 35 && /^\d+$/.test(line)) return true;
    if (line.length === 34 && line[9] === '3' && /^\d+$/.test(line)) return true;
  }
  return false;
}

function afdHttpSnippet(text, max = 220) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s || '(corpo vazio)';
}

/** Sonda GET: Control iD idClass costuma responder "POST expected" em GET sobre /api/*. */
async function probeDeviceWantsPostForApi(base) {
  const url = `${base}/api/punches`;
  try {
    const res = await clockGet(url, { timeoutMs: 8000, maxBytes: 8192 });
    const text = String(res.text || '');
    const low = text.toLowerCase();
    if (/post\s*expected|bad request:\s*post/i.test(low)) return true;
    if ((res.status === 400 || res.status === 405) && low.includes('post')) return true;
  } catch {
    /* ignora */
  }
  return false;
}

/**
 * POST /login.fcgi — Control iD idClass (MODO PRODUÇÃO).
 * Nunca lança: em falha devolve null e regista [REP LOGIN ERROR] (sem palavra-passe).
 */
async function loginControlId(base) {
  const password = (process.env.REP_DEVICE_PASSWORD || '').trim();
  if (!password) return null;
  const login = (process.env.REP_DEVICE_LOGIN || 'admin').trim() || 'admin';
  const url = `${base}/login.fcgi`;
  try {
    const res = await clockPostJson(url, { login, password });
    if (res.status < 200 || res.status >= 300) {
      console.error('[REP LOGIN ERROR]', `HTTP ${res.status}`, afdHttpSnippet(res.text));
      return null;
    }
    const data = parseJsonSafe(res.text);
    if (!data || typeof data !== 'object') {
      console.error('[REP LOGIN ERROR]', 'resposta não-JSON', afdHttpSnippet(res.text));
      return null;
    }
    if (data.error) {
      console.error('[REP LOGIN ERROR]', String(data.error));
      return null;
    }
    const sid = typeof data.session === 'string' ? data.session.trim() : '';
    if (!sid) {
      console.error('[REP LOGIN ERROR]', 'sem campo session', afdHttpSnippet(res.text));
      return null;
    }
    console.log('[REP LOGIN SUCCESS]');
    const sessLog = sid.length <= 16 ? sid : `${sid.slice(0, 12)}…`;
    console.log('[REP SESSION]', sessLog);
    return sid;
  } catch (e) {
    console.error('[REP LOGIN ERROR]', e?.message || String(e));
    return null;
  }
}

/**
 * POST /get_afd.fcgi?session=… — conteúdo AFD bruto (text/plain ou application/octet-stream).
 */
async function fetchAfdWithSession(base, session) {
  const sid = encodeURIComponent(session);
  const urls = repAfdPortaria671
    ? [`${base}/get_afd.fcgi?session=${sid}&mode=671`, `${base}/get_afd.fcgi?session=${sid}`]
    : [`${base}/get_afd.fcgi?session=${sid}`, `${base}/get_afd.fcgi?session=${sid}&mode=671`];
  for (const url of urls) {
    try {
      const res = await clockPostAfdBinary(url, {});
      if (res.status < 200 || res.status >= 300) {
        console.log('[REP AFD SESSION]', url.split('?')[0], '→ HTTP', res.status, afdHttpSnippet(res.text));
        continue;
      }
      const text = res.text || '';
      if (isPlausibleAfdText(text)) return text;
      console.log('[REP AFD SESSION] corpo não reconhecido como AFD:', afdHttpSnippet(text));
    } catch (e) {
      console.error('[REP AFD SESSION]', e?.message || String(e));
    }
  }
  return null;
}

/**
 * ANTES do download AFD por GET: Control iD idClass (sessão + get_afd.fcgi).
 * Se login falhar ou não houver meio de obter sessão, devolve null (mantém fluxo atual).
 */
async function tryAfdControlIdSessionDownload(base) {
  let postExpected = false;
  try {
    postExpected = await probeDeviceWantsPostForApi(base);
  } catch {
    postExpected = false;
  }
  const looksControlId = !!(repDeviceSession || repDevicePassword || repDeviceControlIdFcgi || postExpected);
  if (!looksControlId) return null;

  let session = repDeviceSession;
  if (!session) {
    session = await loginControlId(base);
    if (!session) return null;
  }

  const raw = await fetchAfdWithSession(base, session);
  if (!raw || !isPlausibleAfdText(raw)) return null;

  console.log('[REP AFD DOWNLOAD SESSION MODE]');
  return { url: `${base}/get_afd.fcgi`, content: raw };
}

/**
 * Baixa o AFD do dispositivo testando rotas conhecidas (priorizando REP_AFD_PATH).
 * Retorna { url, content } no primeiro sucesso. Aplica timeout e retry por rota.
 */
async function downloadAFD() {
  const base = `${scheme}://${ip}:${port}`;

  const sessionMode = await tryAfdControlIdSessionDownload(base);
  if (sessionMode) return sessionMode;

  const candidates = [];
  if (repAfdPathEnv) {
    candidates.push(repAfdPathEnv.startsWith('/') ? repAfdPathEnv : `/${repAfdPathEnv}`);
  }
  for (const p of AFD_DOWNLOAD_PATHS) {
    if (!candidates.includes(p)) candidates.push(p);
  }

  let lastErr = null;
  for (const candidatePath of candidates) {
    const url = `${base}${candidatePath}`;
    for (let attempt = 1; attempt <= REP_AFD_RETRY; attempt += 1) {
      try {
        const res = await clockGet(url);
        const okHttp = res.status >= 200 && res.status < 300;
        if (!okHttp) {
          lastErr = new Error(`HTTP ${res.status} em ${url}`);
          const snip = attempt === 1 && res.text ? ` | ${afdHttpSnippet(res.text)}` : '';
          console.log(`[REP AFD TRY] ${url} (tentativa ${attempt}/${REP_AFD_RETRY}) → HTTP ${res.status}${snip}`);
          continue;
        }
        const content = res.text || '';
        if (isPlausibleAfdText(content)) {
          console.log(`[REP AFD DOWNLOAD] sucesso (${content.length} bytes) via ${url}`);
          return { url, content };
        }
        // Verificação mínima de plausibilidade (legado): precisa conter pelo menos 1 linha "ASCII numérica" longa.
        if (!content || content.length < 16) {
          lastErr = new Error(`Conteúdo vazio/curto em ${url} (${content.length} bytes)`);
          console.log(`[REP AFD TRY] ${url} → conteúdo curto (${content.length} bytes)`);
          continue;
        }
        // Se vier HTML (página de login etc.), descarta.
        const head = content.slice(0, 256).toLowerCase();
        if (head.includes('<html') || head.includes('<!doctype')) {
          lastErr = new Error(`Resposta HTML em ${url} — provavelmente página de login/erro`);
          console.log(`[REP AFD TRY] ${url} → resposta HTML, ignorando`);
          continue;
        }
        lastErr = new Error(`Resposta em ${url} não parece AFD (linhas numéricas esperadas)`);
        console.log(`[REP AFD TRY] ${url} → corpo não reconhecido como AFD (${afdHttpSnippet(content)})`);
      } catch (e) {
        lastErr = e;
        console.error(
          `[REP AFD ERROR] ${url} (tentativa ${attempt}/${REP_AFD_RETRY}): ${e?.message || String(e)}`
        );
        // backoff curto entre retries
        if (attempt < REP_AFD_RETRY) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
  }

  if (!repDeviceSession && !repDevicePassword && !repDeviceControlIdFcgi) {
    console.warn(
      '[rep-agent] Dica Control iD iDClass: o AFD obtém-se com POST /get_afd.fcgi?session=… (após POST /login.fcgi). Defina REP_DEVICE_PASSWORD e opcionalmente REP_DEVICE_LOGIN (default admin), ou REP_DEVICE_SESSION. Para formato Portaria 671: REP_AFD_PORTARIA_671=1.'
    );
  } else if (repDevicePassword || repDeviceSession) {
    console.warn(
      '[rep-agent] login/get_afd.fcgi não devolveram AFD reconhecível; verifique credenciais, firmware ou tente REP_AFD_PORTARIA_671=1.'
    );
  }

  const msg = lastErr ? lastErr.message || String(lastErr) : 'Nenhuma rota de AFD respondeu';
  throw new Error(`[REP AFD ERROR] ${msg}`);
}

/**
 * Parser de AFD (formato simplificado): cada linha contém
 *   NSR (12) + DATA (8: YYYYMMDD) + HORA (4: HHMM) + PIS (11)
 * Total: 35 caracteres por registro.
 *
 * Também tolera o formato oficial Portaria 1510 — Tipo 3:
 *   NSR (9) + "3" + DATA (8) + HORA (4) + PIS (12) = 34 chars
 * Quando detectado, extrai os mesmos campos (date/time/pis/nsr).
 */
function parseAFD(content) {
  if (!content || typeof content !== 'string') return [];
  const lines = content.split(/\r?\n/);
  const records = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!/^\d+$/.test(line)) continue; // só dígitos

    let parsed = null;

    // Formato simplificado solicitado: 35 chars (NSR12 + DATA8 + HORA4 + PIS11)
    if (line.length === 35) {
      const nsr = line.slice(0, 12);
      const dateRaw = line.slice(12, 20);
      const timeRaw = line.slice(20, 24);
      const pis = line.slice(24, 35);
      parsed = buildAfdRecord({ nsr, dateRaw, timeRaw, pis });
    }
    // Formato oficial Portaria 1510 — Tipo 3 (34 chars):
    //   NSR(9) + "3" + DATA(8) + HORA(4) + PIS(12)
    else if (line.length === 34 && line[9] === '3') {
      const nsr = line.slice(0, 9);
      const dateRaw = line.slice(10, 18);
      const timeRaw = line.slice(18, 22);
      const pis = line.slice(22, 34);
      parsed = buildAfdRecord({ nsr, dateRaw, timeRaw, pis });
    }

    if (parsed) records.push(parsed);
  }

  return records;
}

function buildAfdRecord({ nsr, dateRaw, timeRaw, pis }) {
  if (!/^\d{8}$/.test(dateRaw)) return null;
  if (!/^\d{4}$/.test(timeRaw)) return null;

  const year = Number(dateRaw.slice(0, 4));
  const month = Number(dateRaw.slice(4, 6));
  const day = Number(dateRaw.slice(6, 8));
  const hour = Number(timeRaw.slice(0, 2));
  const minute = Number(timeRaw.slice(2, 4));

  if (year < 1970 || year > 2999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
  const time = `${timeRaw.slice(0, 2)}:${timeRaw.slice(2, 4)}`;

  return { nsr, date, time, pis };
}

/** Converte registro AFD para o payload aceito por /api/rep/punch (sem alterar o contrato). */
function normalizeAfdPunch(rec) {
  return {
    company_id: companyId,
    device_id: deviceId,
    employee_identifier: rec.pis,
    pis: rec.pis,
    // AFD vem em horário local do relógio; anexamos o offset configurado para o backend
    // interpretar corretamente (evita bug clássico de "batida adiantada/atrasada").
    data_hora: `${rec.date}T${rec.time}:00${REP_DEVICE_TIMEZONE_OFFSET}`,
    origem: 'REP',
    nsr: rec.nsr,
  };
}

/** Compara dois NSRs (string ou number). Usa BigInt quando ambos forem numéricos. */
function compareNsr(a, b) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  if (!sa && !sb) return 0;
  if (!sa) return -1;
  if (!sb) return 1;
  try {
    const ba = BigInt(sa);
    const bb = BigInt(sb);
    if (ba === bb) return 0;
    return ba > bb ? 1 : -1;
  } catch {
    if (sa === sb) return 0;
    return sa > sb ? 1 : -1;
  }
}

function deviceKey() {
  if (deviceId) return `device_${deviceId}`;
  return `device_${ip}_${port}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------------------
// Cache local de NSRs já processados (evita reenvio mesmo após reiniciar o agente)
// ----------------------------------------------------------------------------

async function loadProcessedNsrCache() {
  try {
    const raw = await fs.readFile(REP_AFD_CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data?.nsrs) ? data.nsrs : [];
    return new Set(list.map((v) => String(v)));
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      console.error('[REP AFD CACHE] Falha ao ler cache, iniciando vazio:', e.message || e);
    }
    return new Set();
  }
}

async function saveProcessedNsrCache(set) {
  try {
    await fs.mkdir(path.dirname(REP_AFD_CACHE_FILE), { recursive: true });
    const payload = {
      updated_at: new Date().toISOString(),
      count: set.size,
      nsrs: Array.from(set),
    };
    await fs.writeFile(REP_AFD_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.error('[REP AFD CACHE] Falha ao persistir cache:', e?.message || e);
  }
}

// ----------------------------------------------------------------------------
// Controle de último NSR processado por dispositivo (data/rep-agent/last-nsr.json)
// Estrutura plana: { "device_xxx": "000000123456" }
// Regra: antes de enviar → se nsr <= lastNSR, skip.
// Após sucesso             → lastNSR = nsr (se maior) e persiste imediatamente.
// ----------------------------------------------------------------------------

async function loadLastNsrMap() {
  try {
    const raw = await fs.readFile(REP_LAST_NSR_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof k === 'string' && v != null) out[k] = String(v);
    }
    return out;
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      console.error('[REP LAST NSR] Falha ao ler arquivo, iniciando vazio:', e.message || e);
    }
    return {};
  }
}

async function saveLastNsrMap(map) {
  try {
    await fs.mkdir(path.dirname(REP_LAST_NSR_FILE), { recursive: true });
    await fs.writeFile(REP_LAST_NSR_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('[REP LAST NSR] Falha ao persistir:', e?.message || e);
  }
}

// ----------------------------------------------------------------------------
// Ingestão via AFD
// ----------------------------------------------------------------------------

async function ingestViaAFD() {
  console.log('[REP MODE] AFD ativado');

  let downloaded;
  try {
    downloaded = await downloadAFD();
  } catch (e) {
    // Fallback final: relógio NÃO expõe AFD via HTTP (modelos que só exportam por USB
    // ou software do fabricante). Não derrubamos o agente — sinalizamos modo manual
    // para o operador e seguimos esperando o próximo ciclo / upload manual futuro.
    console.error('[REP AFD NOT AVAILABLE]', e?.message || e);
    console.log('[REP DEVICE STATE] mode=MANUAL_IMPORT_REQUIRED — aguardando upload manual de AFD ou integração com software do fabricante.');
    return {
      mode: 'MANUAL_IMPORT_REQUIRED',
      ok: 0,
      skip: 0,
      duplicate: 0,
      preSkipped: 0,
      total: 0,
    };
  }

  const { url, content } = downloaded;
  const records = parseAFD(content);
  console.log('[REP AFD PARSED]', `${records.length} registros`, '|', url);

  if (records.length === 0) {
    console.log('[rep-agent] AFD sem registros válidos para enviar.');
    return { mode: 'AFD', ok: 0, skip: 0, duplicate: 0, preSkipped: 0, total: 0 };
  }

  const processed = await loadProcessedNsrCache();
  const lastNsrMap = await loadLastNsrMap();
  const devKey = deviceKey();
  let lastNsr = lastNsrMap[devKey] || '';

  let ok = 0;
  let skip = 0;
  let preSkipped = 0;
  let dupLocal = 0;
  let dupServer = 0;
  const dupLocalSamples = [];
  const dupServerSamples = [];
  const MAX_DUP_SAMPLES = 10;

  for (const rec of records) {
    const nsrKey = String(rec.nsr);

    // Filtro incremental por último NSR processado (regra obrigatória do enunciado).
    if (lastNsr && compareNsr(nsrKey, lastNsr) <= 0) {
      preSkipped += 1;
      continue;
    }

    if (processed.has(nsrKey)) {
      dupLocal += 1;
      if (dupLocalSamples.length < MAX_DUP_SAMPLES) dupLocalSamples.push(nsrKey);
      continue;
    }

    const body = normalizeAfdPunch(rec);
    try {
      const r = await postPunch(body);
      const wasDuplicate = !!(r && r.success === false && r.duplicate);

      processed.add(nsrKey);
      if (wasDuplicate) {
        dupServer += 1;
        if (dupServerSamples.length < MAX_DUP_SAMPLES) dupServerSamples.push(nsrKey);
      } else {
        ok += 1;
        console.log(`[REP PUNCH SENT] nsr=${nsrKey} pis=${rec.pis} data=${rec.date} hora=${rec.time}`);
      }

      // Avança o ponteiro incremental imediatamente após sucesso (mesmo em duplicate
      // do servidor, pois o registro já foi reconhecido pelo backend).
      if (!lastNsr || compareNsr(nsrKey, lastNsr) > 0) {
        lastNsr = nsrKey;
        lastNsrMap[devKey] = lastNsr;
        await saveLastNsrMap(lastNsrMap);
      }
    } catch (e) {
      skip += 1;
      console.error(`[REP PUNCH ERROR] nsr=${nsrKey}: ${e?.message || e}`);
    }
  }

  const duplicate = dupLocal + dupServer;

  if (dupLocal > 0) {
    const extra = dupLocal > dupLocalSamples.length ? ` (+${dupLocal - dupLocalSamples.length} outros)` : '';
    console.log(
      `[REP DUPLICATE] ${dupLocal} NSR(s) já em cache local (${path.basename(REP_AFD_CACHE_FILE)}): ${dupLocalSamples.join(', ')}${extra}`
    );
  }
  if (dupServer > 0) {
    const extra = dupServer > dupServerSamples.length ? ` (+${dupServer - dupServerSamples.length} outros)` : '';
    console.log(
      `[REP DUPLICATE] ${dupServer} NSR(s) já existentes no servidor (API): ${dupServerSamples.join(', ')}${extra}`
    );
  }

  if (ok === 0 && skip === 0 && records.length > 0 && duplicate === records.length && preSkipped === 0) {
    console.log(
      '[rep-agent] Nenhum envio novo: todos os registos do AFD já tinham sido tratados. Para repetir teste com o mesmo ficheiro/mock: apague a pasta data\\rep-agent (ou só processed-nsr.json + last-nsr.json).'
    );
  }

  await saveProcessedNsrCache(processed);

  if (preSkipped > 0) {
    console.log(`[REP NSR FILTER] ${preSkipped} registros anteriores ao lastNSR=${lastNsrMap[devKey] || '(vazio)'} ignorados (${devKey})`);
  }

  return { mode: 'AFD', ok, skip, duplicate, preSkipped, total: records.length };
}

// ----------------------------------------------------------------------------
// Decisão de modo + main()
// ----------------------------------------------------------------------------

function shouldForceAfdMode() {
  return repModeEnv === 'AFD';
}

/** Heurística: dispositivo respondeu de forma consistente "Invalid command: none". */
function shouldFallbackToAfd(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.connectionRefusedAll) return false;
  const attempts = Number(err.attempts || 0);
  const hits = Number(err.invalidCommandHits || 0);
  if (attempts === 0) return false;
  if (hits >= Math.max(3, Math.floor(attempts * 0.6))) return true;
  const under = String(err.lastUnderlyingMessage || '');
  if (hits === 0 && attempts >= 6 && /HTTP\s+30\d\b/.test(under)) return true;
  return false;
}

async function ingestViaApiDirect() {
  console.log(
    '[rep-agent] Varrendo relógio',
    `${scheme}://${ip}:${port}`,
    `| ${DEVICE_ENDPOINT_PATHS.length} rotas × ${buildCommandPayloads().length} payloads`
  );
  const { list, url } = await fetchPunchesFromClock();
  console.log('[rep-agent] Endpoint OK:', url, '| registros:', list.length);

  const lastNsrMap = await loadLastNsrMap();
  const devKey = deviceKey();
  let lastNsr = lastNsrMap[devKey] || '';

  let ok = 0;
  let skip = 0;
  let preSkipped = 0;
  for (const p of list) {
    const data_hora = pickDataHora(p);
    if (!data_hora) {
      skip += 1;
      continue;
    }
    const rawNsr = p.nsr;
    const hasNsr = rawNsr != null && rawNsr !== '';

    if (hasNsr && lastNsr && compareNsr(rawNsr, lastNsr) <= 0) {
      preSkipped += 1;
      continue;
    }

    const body = {
      company_id: companyId,
      device_id: deviceId,
      data_hora,
      tipo_marcacao: normalizeTipo(p.tipo ?? p.type),
      pis: p.pis ?? p.pisPasep ?? undefined,
      cpf: p.cpf ?? undefined,
      matricula: p.matricula ?? p.badge ?? undefined,
      nsr: typeof rawNsr === 'number' ? rawNsr : undefined,
    };
    try {
      const r = await postPunch(body);
      if (r.success === false && r.duplicate) skip += 1;
      else ok += 1;

      if (hasNsr && (!lastNsr || compareNsr(rawNsr, lastNsr) > 0)) {
        lastNsr = String(rawNsr);
        lastNsrMap[devKey] = lastNsr;
        await saveLastNsrMap(lastNsrMap);
      }
    } catch (e) {
      console.error('[rep-agent] Erro ao enviar marcação:', e.message, body);
    }
  }
  if (preSkipped > 0) {
    console.log(`[REP NSR FILTER] ${preSkipped} registros anteriores ao lastNSR=${lastNsrMap[devKey] || '(vazio)'} ignorados (${devKey})`);
  }
  console.log('[rep-agent] Concluído. Enviados OK:', ok, '| ignorados/duplicados:', skip);
  return { ok, skip, preSkipped };
}

async function runCycle() {
  if (shouldForceAfdMode()) {
    console.log('[REP MODE] AFD ativado (REP_MODE=AFD)');
    const r = await ingestViaAFD();
    if (r.mode === 'MANUAL_IMPORT_REQUIRED') {
      console.log('[rep-agent] Ciclo encerrado em modo MANUAL_IMPORT_REQUIRED.');
    } else {
      console.log(
        `[rep-agent] AFD concluído. Enviados OK: ${r.ok} | duplicados: ${r.duplicate} | erros: ${r.skip} | filtrados (lastNSR): ${r.preSkipped} | total parseado: ${r.total}`
      );
    }
    return r;
  }

  try {
    return await ingestViaApiDirect();
  } catch (e) {
    if (shouldFallbackToAfd(e)) {
      console.log('[REP MODE] AFD ativado (fallback: dispositivo retornou "Invalid command: none")');
      const r = await ingestViaAFD();
      if (r.mode === 'MANUAL_IMPORT_REQUIRED') {
        console.log('[rep-agent] Ciclo encerrado em modo MANUAL_IMPORT_REQUIRED.');
      } else {
        console.log(
          `[rep-agent] AFD concluído. Enviados OK: ${r.ok} | duplicados: ${r.duplicate} | erros: ${r.skip} | filtrados (lastNSR): ${r.preSkipped} | total parseado: ${r.total}`
        );
      }
      return r;
    }
    throw e;
  }
}

async function main() {
  const loopEnabled = REP_AGENT_LOOP && !CLI_ONCE;

  if (!loopEnabled) {
    await runCycle();
    return;
  }

  let stopping = false;
  const stopOn = (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`[REP AGENT LOOP] sinal ${sig} recebido, encerrando após o ciclo atual.`);
  };
  process.on('SIGINT', () => stopOn('SIGINT'));
  process.on('SIGTERM', () => stopOn('SIGTERM'));

  console.log(
    `[REP AGENT LOOP] iniciado. intervalo=${REP_AGENT_INTERVAL_MS}ms tz=${REP_DEVICE_TIMEZONE_OFFSET} device=${deviceKey()}`
  );

  while (!stopping) {
    const t0 = Date.now();
    try {
      await runCycle();
    } catch (e) {
      // Loop é resiliente: nenhum erro pontual derruba o serviço.
      console.error('[REP AGENT LOOP] ciclo falhou:', e?.message || e);
    }
    if (stopping) break;
    const elapsed = Date.now() - t0;
    const wait = Math.max(1000, REP_AGENT_INTERVAL_MS - elapsed);
    console.log(`[REP AGENT LOOP] aguardando próximo ciclo (${wait}ms)`);
    await sleep(wait);
  }

  console.log('[REP AGENT LOOP] encerrado.');
}

main().catch((e) => {
  console.error('[rep-agent]', e);
  process.exit(1);
});
