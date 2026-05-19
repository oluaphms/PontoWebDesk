/**
 * Política go-live safe do REP Agent: primeira execução, meta local e override manual.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const VOLUME_AIRBAG_THRESHOLD = 5000;

export function localTodayYmd() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseYmdToMs(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return NaN;
  return new Date(`${ymd}T00:00:00`).getTime();
}

/** Fim do dia civil local (23:59:59.999) para filtro date_range. */
export function parseYmdEndMs(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return NaN;
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export function validateIngestFromDateEnv(ymd, { allowFutureThrow = true } = {}) {
  if (!ymd) return { ms: NaN, ymd: '' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error('REP_INGEST_FROM_DATE deve ser YYYY-MM-DD (ex.: 2026-05-18).');
  }
  const ms = parseYmdToMs(ymd);
  if (Number.isNaN(ms)) {
    throw new Error(`REP_INGEST_FROM_DATE inválida: "${ymd}".`);
  }
  const todayStart = parseYmdToMs(localTodayYmd());
  if (allowFutureThrow && ms > todayStart) {
    throw new Error('Data de ingestão inválida (futuro)');
  }
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  if (ms < oneYearAgo.getTime()) {
    console.warn('[BOOT] Data muito antiga — possível importação massiva');
  }
  return { ms, ymd };
}

export async function loadAgentMeta(metaPath) {
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const data = JSON.parse(raw);
    return {
      firstRunCompleted: data?.firstRunCompleted === true,
      initializedAt: typeof data?.initializedAt === 'string' ? data.initializedAt : null,
    };
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      console.warn('[BOOT] Falha ao ler agent-meta.json, tratando como primeira execução:', e.message || e);
    }
    return { firstRunCompleted: false, initializedAt: null };
  }
}

export async function saveAgentMeta(metaPath, meta) {
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        firstRunCompleted: meta.firstRunCompleted === true,
        initializedAt: meta.initializedAt ?? null,
      },
      null,
      2
    ),
    'utf8'
  );
}

export async function fetchServerAgentConfig({ saas, apiKey, companyId, timeoutMs = 8000 }) {
  if (!saas || !apiKey || !companyId) return null;
  const url = `${saas.replace(/\/+$/, '')}/api/rep/agent-config?company_id=${encodeURIComponent(companyId)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ac.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (!res.ok) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve escopo efetivo (mutável por ciclo após promoção).
 * @returns {{ scope: 'incremental'|'today_only', fromDateMs: number, fromDateStr: string, isFirstRun: boolean, meta: object, autoMode: boolean, forceMode: boolean }}
 */
export async function resolveAgentReceivePolicy(ctx) {
  const {
    metaPath,
    forceMode,
    envScopeRaw,
    envIngestFromDate,
    envIngestEndDate,
    saas,
    apiKey,
    companyId,
  } = ctx;

  const meta = await loadAgentMeta(metaPath);
  const isFirstRun = !meta.firstRunCompleted;

  const envIngestEndDate = String(ctx.envIngestEndDate || '').trim();

  if (forceMode) {
    let scope =
      envScopeRaw === 'today_only'
        ? 'today_only'
        : envScopeRaw === 'date_range'
          ? 'date_range'
          : 'incremental';
    let fromDateMs = NaN;
    let fromDateStr = '';
    let toDateMs = NaN;
    let toDateStr = '';
    if (envIngestFromDate) {
      const v = validateIngestFromDateEnv(envIngestFromDate);
      fromDateMs = v.ms;
      fromDateStr = v.ymd;
    }
    if (envIngestEndDate) {
      const v = validateIngestFromDateEnv(envIngestEndDate, { allowFutureThrow: false });
      toDateMs = parseYmdEndMs(v.ymd);
      toDateStr = v.ymd;
    }
    if (scope === 'date_range' && !fromDateStr && envIngestFromDate) {
      const v = validateIngestFromDateEnv(envIngestFromDate);
      fromDateMs = v.ms;
      fromDateStr = v.ymd;
    }
    console.log('[BOOT] REP_FORCE_MODE=1 — usando configuração do .env sem auto-ajuste.');
    return {
      scope,
      fromDateMs,
      fromDateStr,
      toDateMs,
      toDateStr,
      isFirstRun,
      meta,
      autoMode: false,
      forceMode: true,
    };
  }

  const serverCfg = await fetchServerAgentConfig({ saas, apiKey, companyId });
  if (serverCfg?.recommendedScope || serverCfg?.goLiveDate) {
    console.log(
      '[BOOT] Configuração do servidor:',
      serverCfg.recommendedScope ? `scope=${serverCfg.recommendedScope}` : '',
      serverCfg.goLiveDate ? `goLiveDate=${serverCfg.goLiveDate}` : ''
    );
  }

  const productionMode =
    serverCfg?.firstRunPolicy === 'incremental_from_today' ||
    process.env.REP_PRODUCTION_MODE === '1' ||
    /^(1|true|yes)$/i.test(String(process.env.REP_PRODUCTION_MODE ?? '1').trim());

  if (isFirstRun) {
    console.log('[BOOT] Primeira execução detectada');
    const today = localTodayYmd();
    if (productionMode) {
      console.log('[BOOT] Modo produção: incremental desde hoje (sem importar histórico inteiro)');
      return {
        scope: 'incremental',
        fromDateMs: parseYmdToMs(today),
        fromDateStr: today,
        toDateMs: NaN,
        toDateStr: '',
        isFirstRun: true,
        meta,
        autoMode: true,
        forceMode: false,
        serverCfg,
      };
    }
    console.log('[BOOT] Modo legado: today_only (defina REP_PRODUCTION_MODE=1 para incremental)');
    return {
      scope: 'today_only',
      fromDateMs: parseYmdToMs(today),
      fromDateStr: today,
      toDateMs: NaN,
      toDateStr: '',
      isFirstRun: true,
      meta,
      autoMode: true,
      forceMode: false,
      serverCfg,
    };
  }

  let scope = 'incremental';
  let fromDateMs = NaN;
  let fromDateStr = '';
  let toDateMs = NaN;
  let toDateStr = '';

  if (envScopeRaw === 'today_only' && !productionMode) {
    scope = 'today_only';
  } else if (envScopeRaw === 'date_range') {
    scope = 'date_range';
  }

  /** Só filtra por data se o operador definiu explicitamente (não usar goLiveDate do servidor). */
  if (envIngestFromDate) {
    try {
      const v = validateIngestFromDateEnv(envIngestFromDate, { allowFutureThrow: true });
      fromDateMs = v.ms;
      fromDateStr = v.ymd;
    } catch (e) {
      throw e;
    }
  }
  if (envIngestEndDate) {
    try {
      const v = validateIngestFromDateEnv(envIngestEndDate, { allowFutureThrow: false });
      toDateMs = parseYmdEndMs(v.ymd);
      toDateStr = v.ymd;
      if (scope === 'incremental') scope = 'date_range';
    } catch (e) {
      throw e;
    }
  }

  console.log('[MODE] Operando em modo incremental (primeira execução já concluída).');
  return {
    scope,
    fromDateMs,
    fromDateStr,
    toDateMs,
    toDateStr,
    isFirstRun: false,
    meta,
    autoMode: true,
    forceMode: false,
    serverCfg,
  };
}

export function logSyncCounts(readCount, afterFilter) {
  const fmt = (n) => Number(n).toLocaleString('pt-BR');
  console.log(`[SYNC] Registros lidos: ${fmt(readCount)}`);
  console.log(`[SYNC] Registros após filtro: ${fmt(afterFilter)}`);
}

export function isFirstRunPromotionEligible(cycleResult) {
  if (!cycleResult || cycleResult.fatal) return false;
  if (Number(cycleResult.sendErrors || 0) > 0) return false;
  if (cycleResult.mode === 'MANUAL_IMPORT_REQUIRED') return false;
  return true;
}

export async function promoteAgentAfterFirstSuccess(metaPath, meta, onPromoted) {
  const next = {
    firstRunCompleted: true,
    initializedAt: new Date().toISOString(),
  };
  await saveAgentMeta(metaPath, next);
  console.log('[MODE] Mudando para incremental após inicialização');
  if (typeof onPromoted === 'function') {
    onPromoted(next);
  }
  return next;
}
