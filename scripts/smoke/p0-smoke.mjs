#!/usr/bin/env node
/**
 * P0.5 — Smoke tests da API VPS (path LOCAL_API).
 *
 * Uso:
 *   API_BASE=http://localhost:3000/api node scripts/smoke/p0-smoke.mjs
 *
 * Opcional (fluxos autenticados):
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke/p0-smoke.mjs
 *
 * Emite PASSOU ou FALHOU com motivo. Não altera regras de negócio.
 */
import process from 'node:process';

const API_BASE = String(process.env.API_BASE || 'http://localhost:3000/api').replace(/\/+$/, '');
const email = String(process.env.SMOKE_EMAIL || '').trim();
const password = String(process.env.SMOKE_PASSWORD || '').trim();

/** @type {{ name: string; ok: boolean; detail?: string }[]} */
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'OK' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, path, { token, body, headers } = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const h = { Accept: 'application/json', ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function main() {
  console.log(`P0 Smoke — API_BASE=${API_BASE}`);

  // --- Health / readiness ---
  {
    const { res, json } = await req('GET', '/health/live');
    record('API liveness', res.ok && json?.status === 'ok', `status=${res.status}`);
  }
  {
    const { res, json } = await req('GET', '/health');
    record('API health', res.ok && (json?.status === 'ok' || json?.db === 'connected'), `status=${res.status}`);
  }
  {
    const { res, json } = await req('GET', '/health/db');
    record('DB connected', res.ok && json?.db === 'connected', `status=${res.status}`);
  }
  {
    const { res, json } = await req('GET', '/health/ready');
    record('Readiness', res.ok && json?.status === 'ok', `status=${res.status}`);
  }
  {
    const { res } = await req('GET', '/health/time');
    record('Health time', res.ok, `status=${res.status}`);
  }
  {
    // Endpoint protegido (Master key) desde hardening — anônimo deve ser 401.
    const anon = await req('GET', '/metrics/summary');
    const masterKey = String(process.env.MASTER_API_KEY || '').trim();
    if (masterKey) {
      const auth = await req('GET', '/metrics/summary', {
        headers: { 'x-master-key': masterKey },
      });
      record(
        'Metrics summary',
        anon.res.status === 401 && auth.res.ok && auth.json?.ok === true,
        `anon=${anon.res.status} auth=${auth.res.status}`,
      );
    } else {
      record(
        'Metrics summary',
        anon.res.status === 401 || (anon.res.ok && anon.json?.ok === true),
        `status=${anon.res.status} (MASTER_API_KEY ausente — só valida bloqueio anônimo)`,
      );
    }
  }

  // --- Auth / tenant (opcional) ---
  let token = '';
  let companyId = '';
  if (email && password) {
    const { res, json } = await req('POST', '/auth/login', {
      body: { email, password },
    });
    const access =
      json?.accessToken || json?.token || json?.data?.accessToken || json?.data?.token || '';
    token = String(access || '').trim();
    record('Login', res.ok && Boolean(token), `status=${res.status}`);

    if (token) {
      const me = await req('GET', '/auth/me', { token });
      companyId = String(me.json?.companyId || me.json?.user?.companyId || me.json?.data?.companyId || '').trim();
      record('JWT /auth/me', me.res.ok, `status=${me.res.status} companyId=${companyId || '?'}`);
      record('Tenant no token/me', Boolean(companyId), companyId ? 'presente' : 'ausente');

      const emp = await req('GET', '/employees?limit=5&offset=0', { token });
      record('List employees', emp.res.ok, `status=${emp.res.status}`);

      const periodEnd = new Date();
      const periodStart = new Date(periodEnd);
      periodStart.setUTCDate(periodStart.getUTCDate() - 7);
      const ymd = (d) => d.toISOString().slice(0, 10);
      const att = await req(
        'GET',
        `/attendance/period?from=${ymd(periodStart)}&to=${ymd(periodEnd)}`,
        { token },
      );
      // Aceita 200 ou 400 de validação — falha só em 5xx / rede
      record(
        'Attendance period (espelho)',
        att.res.status < 500,
        `status=${att.res.status}`,
      );

      const dataTr = await req('GET', '/data/time_records?limit=1', { token });
      record('Data API time_records', dataTr.res.status < 500, `status=${dataTr.res.status}`);

      const bank = await req('GET', '/bank-hours', { token });
      record('Bank hours route', bank.res.status < 500, `status=${bank.res.status}`);
    }
  } else {
    record('Login (skipped)', true, 'SMOKE_EMAIL/SMOKE_PASSWORD não definidos — pulando auth');
    record('Cadastro empresa/funcionário/REP/ponto (skipped)', true, 'requer credenciais + dados seed');
    record('Import/Export/Upload (skipped)', true, 'manual / staging com fixtures');
    record('Realtime (skipped)', true, 'LOCAL_API não usa Realtime Supabase no path oficial');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log('FALHOU');
    for (const f of failed) {
      console.log(` - ${f.name}: ${f.detail || 'sem detalhe'}`);
    }
    process.exit(1);
  }
  console.log('PASSOU');
  process.exit(0);
}

main().catch((err) => {
  console.error('FALHOU');
  const msg = String(err?.cause?.code || err?.message || err);
  if (/fetch failed|ECONNREFUSED/i.test(msg) || err?.cause?.code === 'ECONNREFUSED') {
    console.error(` - API inacessível em ${API_BASE} (${msg})`);
    console.error('   Suba a API: cd backend && npm run dev');
  } else {
    console.error(String(err?.stack || err));
  }
  process.exit(1);
});
