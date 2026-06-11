/**
 * Boot do agente REP: logs obrigatórios, espera de rede, health check e watchdog de heartbeat.
 * Camada Windows/local — não altera SaaS nem coleta REP.
 */
import dns from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { CONFIG_FILE } from './rep-agent-paths.mjs';
import { logBootstrap } from './rep-agent-logger.mjs';

/** Retry de boot: 30s → 60s → 120s (repete o último até conectar). */
export const BOOT_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function bootRetryDelayMs(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  const idx = Math.min(n - 1, BOOT_RETRY_DELAYS_MS.length - 1);
  return BOOT_RETRY_DELAYS_MS[idx];
}

export function logStartupMarker(tag, message, meta) {
  const extra =
    meta && typeof meta === 'object' && Object.keys(meta).length > 0
      ? ` ${JSON.stringify(meta)}`
      : '';
  logBootstrap('INFO', `[${tag}] ${message}${extra}`);
}

function parseSaasHost(saasUrl) {
  const raw = String(saasUrl ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

async function probeNetworkOnce(saasHost) {
  const probes = ['dns.google', 'one.one.one.one'];
  if (saasHost && !probes.includes(saasHost)) probes.unshift(saasHost);
  let lastError = 'sem resposta DNS';
  for (const host of probes) {
    try {
      await dns.lookup(host);
      return { ok: true, host };
    } catch (err) {
      lastError = err?.message || String(err);
    }
  }
  return { ok: false, reason: lastError };
}

/**
 * Aguarda rede até conectar (não encerra o processo).
 * Retry: 30s, 60s, 120s, 120s, …
 */
export async function waitForNetworkReady(opts = {}) {
  const saasHost = String(opts.saasHost ?? '').trim();
  const started = Date.now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    const probe = await probeNetworkOnce(saasHost);
    if (probe.ok) {
      const waited = Date.now() - started;
      logStartupMarker('NETWORK READY', `Rede disponível (${probe.host})`, {
        attempt,
        waited_ms: waited,
      });
      return { ok: true, waited_ms: waited, host: probe.host, attempt };
    }

    const delayMs = bootRetryDelayMs(attempt);
    logStartupMarker('AGENT STARTUP', 'Aguardando rede', {
      attempt,
      next_retry_ms: delayMs,
      reason: probe.reason,
    });
    await sleep(delayMs);
  }
}

/**
 * Valida config, DNS, internet (DNS público) e reachability da API SaaS.
 */
export async function runStartupHealthCheck({ saas, apiKey } = {}) {
  const checks = [];
  const saasUrl = String(saas ?? process.env.REP_SAAS_URL ?? '').trim();

  if (!existsSync(CONFIG_FILE)) {
    checks.push({ name: 'config.json', ok: false, path: CONFIG_FILE });
    return { ok: false, reason: `config.json ausente: ${CONFIG_FILE}`, checks };
  }
  checks.push({ name: 'config.json', ok: true, path: CONFIG_FILE });

  if (!saasUrl) {
    checks.push({ name: 'saas_url', ok: false });
    return { ok: false, reason: 'saas_url não configurado', checks };
  }
  checks.push({ name: 'saas_url', ok: true, value: saasUrl });

  const key = String(apiKey ?? process.env.API_KEY ?? '').trim();
  if (!key) {
    checks.push({ name: 'api_key', ok: false });
    return { ok: false, reason: 'api_key não configurada', checks };
  }
  checks.push({ name: 'api_key', ok: true });

  const host = parseSaasHost(saasUrl);
  if (!host) {
    checks.push({ name: 'dns', ok: false, error: 'saas_url inválida' });
    return { ok: false, reason: 'saas_url inválida (hostname)', checks };
  }

  try {
    await dns.lookup(host);
    checks.push({ name: 'dns', ok: true, host });
  } catch (err) {
    checks.push({ name: 'dns', ok: false, host, error: err?.message || String(err) });
    return { ok: false, reason: `DNS falhou para ${host}: ${err?.message || err}`, checks };
  }

  try {
    await dns.lookup('dns.google');
    checks.push({ name: 'internet', ok: true });
  } catch (err) {
    checks.push({ name: 'internet', ok: false, error: err?.message || String(err) });
    return { ok: false, reason: `Sem internet (DNS público): ${err?.message || err}`, checks };
  }

  const healthUrl = `${saasUrl.replace(/\/+$/, '')}/api/health`;
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(20_000),
    });
    const ok = res.ok || (res.status >= 200 && res.status < 500);
    checks.push({ name: 'api_saas', ok, url: healthUrl, status: res.status });
    if (!ok) {
      return { ok: false, reason: `API SaaS respondeu HTTP ${res.status}`, checks };
    }
  } catch (err) {
    checks.push({ name: 'api_saas', ok: false, url: healthUrl, error: err?.message || String(err) });
    return { ok: false, reason: `API SaaS inacessível: ${err?.message || err}`, checks };
  }

  return { ok: true, checks };
}

/**
 * Health check com retry 30s/60s/120s até a API responder (não encerra o processo).
 */
export async function runStartupHealthCheckUntilReady({ saas, apiKey } = {}) {
  const saasUrl = String(saas ?? process.env.REP_SAAS_URL ?? '').trim();
  if (!saasUrl) {
    logStartupMarker('AGENT STARTUP', 'Health check ignorado — saas_url vazio');
    return { ok: false, skipped: true };
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    const health = await runStartupHealthCheck({ saas: saasUrl, apiKey });
    if (health.ok) {
      logStartupMarker('AGENT STARTUP', 'Health check concluído com sucesso', { checks: health.checks });
      return health;
    }

    const delayMs = bootRetryDelayMs(attempt);
    logStartupMarker('AGENT STARTUP', `Health check falhou: ${health.reason}`, {
      attempt,
      next_retry_ms: delayMs,
      checks: health.checks,
    });
    await sleep(delayMs);
  }
}

/**
 * Watchdog: força novo heartbeat se o loop parar de enviar.
 */
export function startHeartbeatWatchdog({ intervalMs, staleMs, onStale }) {
  const every = Math.max(15_000, Number(intervalMs) || 60_000);
  const stale = Math.max(every * 2, Number(staleMs) || every * 3);
  let lastOkAt = Date.now();
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const silent = Date.now() - lastOkAt;
    if (silent >= stale) {
      logStartupMarker('WATCHDOG', 'Heartbeat parado — forçando reenvio', { silent_ms: silent });
      try {
        onStale?.();
      } catch (err) {
        logBootstrap('ERROR', `[WATCHDOG] falha ao reenviar heartbeat: ${err?.message || err}`);
      }
    }
  }, every);

  if (typeof timer.unref === 'function') timer.unref();

  return {
    markOk() {
      lastOkAt = Date.now();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * Sequência de boot antes do loop principal — nunca encerra por falha de rede/API.
 */
export async function runAgentBootSequence({ saas, apiKey } = {}) {
  logStartupMarker('AGENT STARTUP', 'Iniciando sequência de boot', {
    pid: process.pid,
    node: process.version,
  });

  const saasUrl = String(saas ?? process.env.REP_SAAS_URL ?? '').trim();
  const host = parseSaasHost(saasUrl);

  await waitForNetworkReady({ saasHost: host });
  await runStartupHealthCheckUntilReady({ saas: saasUrl, apiKey });

  logStartupMarker('SERVICE START COMPLETE', 'Boot concluído — entrando no loop operacional');
}
