import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Serviço de geolocalização para registro de ponto (SmartPonto Antifraude).
 * Captura posição via navigator.geolocation + Permissions API quando disponível.
 * Inclui multi-amostragem, filtro de precisão e cache inteligente.
 */

import {
  assertTenantScopedCacheKey,
  buildTenantGeoCacheKey,
  clearTenantScopedCaches,
  registerTenantScopedCache,
  type TenantScope,
} from '../domain/operational/cache/tenantCacheIsolation';
import { appendOperationalTraceSpan, beginOperationalTrace, failOperationalTrace, finalizeOperationalTrace } from '../domain/operational/tracing';
import { recordOperationalMetric } from '../domain/operational/metrics';
import { getSessionTenantScope } from '../auth/sessionAccess';

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp?: number;
  captured_at?: string;
  provider?: string;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  /** Indica se a leitura tem alta precisão (<= 50m) */
  highAccuracy?: boolean;
  /** Número de amostras usadas para calcular esta posição */
  sampleCount?: number;
}

/** Configurações de precisão */
const ACCURACY_THRESHOLD = 50; // metros - limite para considerar alta precisão
const MAX_SAMPLE_ATTEMPTS = 5; // máximo de tentativas para coletar amostras
const SAMPLE_INTERVAL = 800; // ms entre amostras

/** Namespace da cache GEO no localStorage (isolado por tenant/usuario). */
const LAST_LOCATION_KEY_PREFIX = 'geo:last_valid_location:';
const LAST_LOCATION_TIMESTAMP_KEY_PREFIX = 'geo:last_location_timestamp:';
const LOCATION_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutos
const GEO_CACHE_META_KEY = 'geo:last_scope_meta';

export interface GetCurrentLocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface RobustLocationOptions {
  /**
   * Quando true, prioriza leitura fresca (maximumAge=0 na primeira tentativa).
   * Útil para botão "Atualizar".
   */
  forceFresh?: boolean;
}

const DEFAULT_OPTIONS: GetCurrentLocationOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
};

export type GeolocationFailureReason =
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'unsupported'
  | 'insecure_context'
  | 'no_samples';

export type LocationResult =
  | { ok: true; position: GeoPosition }
  | { ok: false; position: null; reason: GeolocationFailureReason; apiMessage?: string };

/** Estado da permissão de geolocalização (Permissions API ou inferido). */
export type GeoPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

function devLog(...args: unknown[]): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof console !== 'undefined') {
    observabilityConsole.info('[Geo]', ...args);
  }
}

function geoLog(tag: string, payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;
  observabilityConsole.info(tag, payload);
}

function readCurrentUserScope(): TenantScope {
  if (typeof window === 'undefined') {
    return { companyId: 'no-company', userId: 'no-user' };
  }
  return getSessionTenantScope();
}

function buildGeoStorageKeys(position: GeoPosition) {
  const scope = readCurrentUserScope();
  const provider = String(position.provider ?? 'browser_geolocation').trim() || 'browser_geolocation';
  const key = buildTenantGeoCacheKey({
    scope,
    provider,
    lat: position.latitude,
    lng: position.longitude,
  });
  assertTenantScopedCacheKey(key);
  return {
    scope,
    provider,
    cacheKey: `${LAST_LOCATION_KEY_PREFIX}${key}`,
    timestampKey: `${LAST_LOCATION_TIMESTAMP_KEY_PREFIX}${key}`,
  };
}

function removeGeoCacheByScope(scope?: Partial<TenantScope>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const company = String(scope?.companyId ?? scope?.tenantId ?? '').trim();
  const user = String(scope?.userId ?? '').trim();
  const keyPrefix = `${LAST_LOCATION_KEY_PREFIX}${company}:${user}:`;
  const tsPrefix = `${LAST_LOCATION_TIMESTAMP_KEY_PREFIX}${company}:${user}:`;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if ((company && user && (k.startsWith(keyPrefix) || k.startsWith(tsPrefix))) || (!company && !user && k.startsWith('geo:last_'))) {
      toRemove.push(k);
    }
  }
  for (const k of toRemove) localStorage.removeItem(k);
}

let geoCacheIsolationBootstrapped = false;
function bootstrapGeoCacheIsolation(): void {
  if (geoCacheIsolationBootstrapped || typeof window === 'undefined') return;
  geoCacheIsolationBootstrapped = true;

  registerTenantScopedCache({
    name: 'geo_location_cache',
    clear: (scope) => removeGeoCacheByScope(scope),
    validate: () => {
      const issues: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(LAST_LOCATION_KEY_PREFIX)) continue;
        const scopedKey = k.slice(LAST_LOCATION_KEY_PREFIX.length);
        try {
          assertTenantScopedCacheKey(scopedKey);
        } catch (error) {
          issues.push(String(error));
        }
      }
      return issues;
    },
  });

  window.addEventListener('current_user_changed', () => {
    clearTenantScopedCaches();
    geoLog('[GEO CACHE INVALIDATION]', { reason: 'current_user_changed' });
  });
}

/**
 * Consulta o status da permissão de geolocalização (Chrome, Edge, alguns mobile).
 * Em navegadores sem Permissions API, retorna 'unknown'.
 */
export async function queryGeolocationPermission(): Promise<GeoPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unsupported';
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    devLog('permission query:', status.state);
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unknown';
  }
}

/** Mensagem curta para o usuário (PT-BR). */
export function geolocationReasonMessage(reason: GeolocationFailureReason): string {
  switch (reason) {
    case 'denied':
      return 'O site não tem permissão para usar o GPS. Ative a localização nas configurações do navegador para este endereço.';
    case 'timeout':
      return 'O GPS demorou demais para responder. Saia ao ar livre, verifique se o GPS está ligado e tente de novo.';
    case 'unavailable':
      return 'Não foi possível obter a posição. Verifique se o GPS está ligado ou tente em outro lugar.';
    case 'unsupported':
      return 'Este navegador não oferece geolocalização.';
    case 'insecure_context':
      return 'Geolocalização exige HTTPS (ou localhost). Acesse o sistema por um endereço seguro.';
    default:
      return 'Não foi possível obter a localização.';
  }
}

/** O que fazer em seguida (ação objetiva). */
export function geolocationActionHint(reason: GeolocationFailureReason): string {
  switch (reason) {
    case 'denied':
      return 'Chrome/Edge: ícone de cadeado ou “i” na barra de endereço → Permissões → Localização → Permitir. No celular: Configurações do site ou do navegador.';
    case 'timeout':
      return 'Toque em “Tentar novamente” ou aguarde alguns segundos com o app em primeiro plano.';
    case 'unavailable':
      return 'Ative o serviço de localização do aparelho e desative modo economia de energia para o navegador.';
    case 'insecure_context':
      return 'Use o mesmo endereço HTTPS publicado pela empresa ou peça ao administrador.';
    case 'unsupported':
      return 'Atualize o navegador ou use Chrome, Edge ou Safari recente.';
    default:
      return 'Toque em “Tentar novamente”.';
  }
}

/** Log de diagnóstico (apenas em desenvolvimento). */
export function logGeolocationDebug(
  phase: string,
  data: {
    permission?: GeoPermissionState;
    reason?: GeolocationFailureReason;
    apiMessage?: string;
    position?: GeoPosition | null;
    samples?: GeoPosition[];
    accuracy?: number;
  }
): void {
  devLog(phase, data);
}

/** Salva a última localização válida no cache */
export function saveLocationToCache(position: GeoPosition): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    bootstrapGeoCacheIsolation();
    const keys = buildGeoStorageKeys(position);
    localStorage.setItem(keys.cacheKey, JSON.stringify(position));
    localStorage.setItem(keys.timestampKey, String(Date.now()));
    localStorage.setItem(GEO_CACHE_META_KEY, JSON.stringify({ ...keys.scope, provider: keys.provider }));
    geoLog('[GEO TENANT CACHE]', {
      company_id: keys.scope.companyId,
      user_id: keys.scope.userId,
      provider: keys.provider,
      cache_key: keys.cacheKey,
    });
    devLog('Cache salvo:', position);
  } catch {
    // Ignora erros de localStorage (modo privado, etc.)
  }
}

/** Recupera a última localização do cache se for recente */
export function getLocationFromCache(): GeoPosition | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    bootstrapGeoCacheIsolation();

    const scope = readCurrentUserScope();
    const scopePrefix = `${LAST_LOCATION_KEY_PREFIX}${scope.companyId}:${scope.userId}:`;
    const candidates: Array<{ cacheKey: string; timestampKey: string; ts: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(scopePrefix)) continue;
      const scopedKey = key.slice(LAST_LOCATION_KEY_PREFIX.length);
      assertTenantScopedCacheKey(scopedKey);
      const tsKey = `${LAST_LOCATION_TIMESTAMP_KEY_PREFIX}${scopedKey}`;
      const ts = Number(localStorage.getItem(tsKey) ?? '0');
      if (Number.isFinite(ts) && ts > 0) {
        candidates.push({ cacheKey: key, timestampKey: tsKey, ts });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.ts - a.ts);
    const winner = candidates[0]!;
    const cached = localStorage.getItem(winner.cacheKey);
    if (!cached) return null;

    const age = Date.now() - winner.ts;
    if (age > LOCATION_CACHE_MAX_AGE) {
      localStorage.removeItem(winner.cacheKey);
      localStorage.removeItem(winner.timestampKey);
      geoLog('[GEO CACHE INVALIDATION]', {
        reason: 'ttl_expired',
        company_id: scope.companyId,
        user_id: scope.userId,
        cache_key: winner.cacheKey,
      });
      devLog('Cache expirado (idade:', Math.round(age / 1000), 's)');
      return null;
    }

    const position = JSON.parse(cached) as GeoPosition;
    geoLog('[GEO CACHE ISOLATION]', {
      company_id: scope.companyId,
      user_id: scope.userId,
      cache_key: winner.cacheKey,
      age_ms: age,
    });
    devLog('Cache recuperado:', position, '(idade:', Math.round(age / 1000), 's)');
    return position;
  } catch {
    return null;
  }
}

/** Limpa o cache de localização */
export function clearLocationCache(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    bootstrapGeoCacheIsolation();
    const scope = readCurrentUserScope();
    removeGeoCacheByScope(scope);
    localStorage.removeItem(GEO_CACHE_META_KEY);
    geoLog('[GEO CACHE INVALIDATION]', {
      reason: 'manual_clear',
      company_id: scope.companyId,
      user_id: scope.userId,
    });
  } catch {
    // Ignora erros
  }
}

/** Calcula a média de múltiplas posições */
function calculateAveragePosition(samples: GeoPosition[]): GeoPosition {
  if (samples.length === 0) {
    throw new Error('Nenhuma amostra para calcular média');
  }

  if (samples.length === 1) {
    return { ...samples[0], sampleCount: 1 };
  }

  // Filtra apenas amostras com precisão aceitável (<= 100m)
  const validSamples = samples.filter(s => s.accuracy <= 100);

  // Se não tiver amostras válidas, usa todas
  const samplesToUse = validSamples.length > 0 ? validSamples : samples;

  // Calcula média ponderada pelo inverso da precisão (amostras mais precisas têm mais peso)
  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLng = 0;
  let weightedAccuracy = 0;

  for (const sample of samplesToUse) {
    const weight = 1 / Math.max(sample.accuracy, 1); // Evita divisão por zero
    totalWeight += weight;
    weightedLat += sample.latitude * weight;
    weightedLng += sample.longitude * weight;
    weightedAccuracy += sample.accuracy * weight;
  }

  const avgLatitude = weightedLat / totalWeight;
  const avgLongitude = weightedLng / totalWeight;
  const avgAccuracy = weightedAccuracy / totalWeight;

  return {
    latitude: avgLatitude,
    longitude: avgLongitude,
    accuracy: Math.round(avgAccuracy),
    timestamp: Date.now(),
    sampleCount: samplesToUse.length,
    highAccuracy: avgAccuracy <= ACCURACY_THRESHOLD,
  };
}

/** Coleta múltiplas amostras de localização */
async function collectLocationSamples(
  maxSamples: number = 3,
  options: GetCurrentLocationOptions = {}
): Promise<GeoPosition[]> {
  const samples: GeoPosition[] = [];
  let attempts = 0;

  while (samples.length < maxSamples && attempts < MAX_SAMPLE_ATTEMPTS) {
    attempts++;
    devLog(`Coletando amostra ${attempts}/${MAX_SAMPLE_ATTEMPTS}...`);

    try {
      const result = await getCurrentLocationResult({
        ...options,
        maximumAge: 0, // Sempre força leitura fresca para amostragem
        timeout: 15000,
      });

      if (result.ok && result.position) {
        samples.push(result.position);
        devLog(`Amostra ${samples.length} obtida:`, result.position);

        // Se a amostra tiver alta precisão, podemos parar mais cedo
        if (result.position.accuracy <= ACCURACY_THRESHOLD && samples.length >= 2) {
          devLog('Alta precisão alcançada, finalizando coleta antecipadamente');
          break;
        }
      }
    } catch (err) {
      devLog('Erro ao coletar amostra:', err);
    }

    // Aguarda intervalo entre amostras (exceto na última)
    if (samples.length < maxSamples && attempts < MAX_SAMPLE_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, SAMPLE_INTERVAL));
    }
  }

  return samples;
}

/**
 * Obtém a localização com motivo de falha (para exibir ao usuário).
 * Força nova leitura do GPS quando maximumAge: 0 (ex.: após “Tentar novamente”).
 */
export function getCurrentLocationResult(options: GetCurrentLocationOptions = {}): Promise<LocationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const scope = readCurrentUserScope();
  const trace = beginOperationalTrace({
    company_id: scope.companyId,
    employee_id: scope.userId,
    source: 'getCurrentLocationResult',
  });
  const t0 = Date.now();

  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      logGeolocationDebug('getCurrentPosition', { reason: 'unsupported' });
      failOperationalTrace(trace.trace_id, 'unsupported');
      resolve({ ok: false, position: null, reason: 'unsupported' });
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
      logGeolocationDebug('insecure_context', { reason: 'insecure_context' });
      failOperationalTrace(trace.trace_id, 'insecure_context');
      resolve({ ok: false, position: null, reason: 'insecure_context' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const pos: GeoPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? 0,
          timestamp: position.timestamp,
          captured_at: new Date(position.timestamp || Date.now()).toISOString(),
          provider: 'browser_geolocation',
          speed: position.coords.speed ?? null,
          heading: position.coords.heading ?? null,
          altitude: position.coords.altitude ?? null,
        };
        geoLog('[GEO CAPTURE]', {
          lat: pos.latitude,
          lng: pos.longitude,
          accuracy: pos.accuracy,
          provider: pos.provider,
          source: 'app',
        });
        const latency = Date.now() - t0;
        appendOperationalTraceSpan({
          trace_id: trace.trace_id,
          type: 'GEO_CAPTURE',
          source: 'navigator.geolocation',
          status: 'ok',
          finished_at: new Date().toISOString(),
          metadata: { accuracy: pos.accuracy, latency_ms: latency },
        });
        recordOperationalMetric('geo_capture_latency_ms', latency, {
          company_id: scope.companyId,
          employee_id: scope.userId,
          source: 'browser_geolocation',
          operation_type: 'geo_capture',
        });
        recordOperationalMetric('geo_snapshot_growth', 1, {
          company_id: scope.companyId,
          employee_id: scope.userId,
          source: 'browser_geolocation',
          operation_type: 'geo_capture',
        });
        finalizeOperationalTrace(trace.trace_id);
        logGeolocationDebug('getCurrentPosition:ok', { position: pos });
        resolve({
          ok: true,
          position: pos,
        });
      },
      (err) => {
        const code = (err as GeolocationPositionError)?.code;
        const apiMessage = (err as GeolocationPositionError)?.message || String(err);
        let reason: GeolocationFailureReason = 'unavailable';
        if (code === 1) reason = 'denied';
        else if (code === 2) reason = 'unavailable';
        else if (code === 3) reason = 'timeout';
        failOperationalTrace(trace.trace_id, apiMessage || reason);
        logGeolocationDebug('getCurrentPosition:error', { reason, apiMessage });
        resolve({ ok: false, position: null, reason, apiMessage });
      },
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeout,
        maximumAge: opts.maximumAge ?? 0,
      }
    );
  });
}

/**
 * Obtém localização com alta precisão usando multi-amostragem.
 * Coleta 3 leituras e calcula a média ponderada pela precisão.
 * Inclui fallback para cache se disponível.
 */
export async function getAccurateLocationWithSampling(
  options: RobustLocationOptions = {}
): Promise<LocationResult> {
  // Coleta múltiplas amostras
  logGeolocationDebug('multiSampling:start', {});
  const samples = await collectLocationSamples(3, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });

  if (samples.length === 0) {
    logGeolocationDebug('multiSampling:fail', { reason: 'no_samples' });
    // Último fallback: tenta uma leitura simples
    return getCurrentLocationResult({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  }

  // Calcula a média das amostras
  const averagedPosition = calculateAveragePosition(samples);

  // Filtra por precisão: se média for ruim (> 100m), tenta mais amostras
  if (averagedPosition.accuracy > 100 && samples.length < MAX_SAMPLE_ATTEMPTS) {
    devLog('Precisão baixa na média, coletando amostras extras...');
    const extraSamples = await collectLocationSamples(2, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });

    if (extraSamples.length > 0) {
      const allSamples = [...samples, ...extraSamples];
      const recalculated = calculateAveragePosition(allSamples);

      // Usa a melhor entre as duas médias
      if (recalculated.accuracy < averagedPosition.accuracy) {
        saveLocationToCache(recalculated);
        logGeolocationDebug('multiSampling:success:recalculated', {
          samples: allSamples,
          accuracy: recalculated.accuracy,
        });
        return { ok: true, position: recalculated };
      }
    }
  }

  // Salva no cache se a precisão for aceitável
  if (averagedPosition.accuracy <= 200) {
    saveLocationToCache(averagedPosition);
  }

  logGeolocationDebug('multiSampling:success', {
    samples,
    accuracy: averagedPosition.accuracy,
  });

  return { ok: true, position: averagedPosition };
}

/**
 * Captura robusta de GPS:
 * 1) Tenta multi-amostragem (alta precisão)
 * 2) Tenta baixa precisão com cache (mais estável indoor)
 * 3) Tenta alta precisão com timeout maior (última tentativa)
 * 4) Fallback para cache se disponível
 */
export async function getCurrentLocationRobustResult(
  options: RobustLocationOptions = {}
): Promise<LocationResult> {
  // ETAPA 1: Multi-amostragem (nova abordagem de alta precisão)
  const multiSample = await getAccurateLocationWithSampling(options);
  if (multiSample.ok && multiSample.position && multiSample.position.accuracy <= ACCURACY_THRESHOLD) {
    return multiSample;
  }

  // Se falhou por permissão ou contexto inseguro, não adianta tentar mais
  if (
    multiSample.ok === false &&
    ['denied', 'unsupported', 'insecure_context'].includes(multiSample.reason)
  ) {
    return multiSample;
  }

  // ETAPA 2: Baixa precisão com cache maior (para ambientes internos)
  const second = await getCurrentLocationResult({
    enableHighAccuracy: false,
    timeout: 15000,
    maximumAge: 0,
  });
  if (second.ok && second.position.accuracy <= 120) {
    // Salva no cache se for boa
    if (second.position.accuracy <= 200) {
      saveLocationToCache(second.position);
    }
    return second;
  }
  if (
    second.ok === false &&
    (second.reason === 'denied' || second.reason === 'unsupported' || second.reason === 'insecure_context')
  ) {
    return second;
  }

  // ETAPA 3: Última tentativa com alta precisão e timeout maior
  const third = await getCurrentLocationResult({
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 0,
  });
  if (third.ok) {
    saveLocationToCache(third.position);
  }

  return third.ok ? third : second;
}

/** Verifica se a localização tem precisão aceitável para registro de ponto */
export function isLocationAccurateEnough(position: GeoPosition, maxAccuracy: number = 100): boolean {
  return position.accuracy <= maxAccuracy;
}

/** Retorna mensagem de status da precisão para o usuário */
export function getAccuracyStatusMessage(accuracy: number): { text: string; color: 'success' | 'warning' | 'error' } {
  if (accuracy <= 20) {
    return { text: `Excelente precisão (~${Math.round(accuracy)}m)`, color: 'success' };
  }
  if (accuracy <= ACCURACY_THRESHOLD) {
    return { text: `Boa precisão (~${Math.round(accuracy)}m)`, color: 'success' };
  }
  if (accuracy <= 100) {
    return { text: `Precisão moderada (~${Math.round(accuracy)}m)`, color: 'warning' };
  }
  return { text: `Precisão baixa (~${Math.round(accuracy)}m)`, color: 'error' };
}

/**
 * Obtém a localização atual do dispositivo.
 * Retorna null se o usuário negar, timeout ou API indisponível.
 */
export function getCurrentLocation(options: GetCurrentLocationOptions = {}): Promise<GeoPosition | null> {
  return getCurrentLocationResult(options).then((r) => (r.ok ? r.position : null));
}

export interface WatchGeoOptions extends GetCurrentLocationOptions {
  /** Intervalo mínimo entre emissões de posição (ms). Padrão 4000. */
  minIntervalMs?: number;
}

/**
 * Atualiza a posição em tempo quase real (`watchPosition`). Retorna função para parar o rastreamento.
 */
export function watchGeoPosition(onResult: (result: LocationResult) => void, options: WatchGeoOptions = {}): () => void {
  const minInterval = options.minIntervalMs ?? 4000;
  let lastEmit = 0;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onResult({ ok: false, position: null, reason: 'unsupported' });
    return () => undefined;
  }

  if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
    onResult({ ok: false, position: null, reason: 'insecure_context' });
    return () => undefined;
  }

  const opts = {
    enableHighAccuracy: options.enableHighAccuracy ?? DEFAULT_OPTIONS.enableHighAccuracy,
    timeout: options.timeout ?? 25000,
    maximumAge: options.maximumAge ?? 0,
  };

  const id = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now();
      if (now - lastEmit < minInterval) return;
      lastEmit = now;
      onResult({
        ok: true,
        position: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? 0,
          timestamp: position.timestamp,
          captured_at: new Date(position.timestamp || Date.now()).toISOString(),
          provider: 'browser_geolocation',
          speed: position.coords.speed ?? null,
          heading: position.coords.heading ?? null,
          altitude: position.coords.altitude ?? null,
        },
      });
    },
    (err) => {
      const code = (err as GeolocationPositionError)?.code;
      const apiMessage = (err as GeolocationPositionError)?.message || String(err);
      let reason: GeolocationFailureReason = 'unavailable';
      if (code === 1) reason = 'denied';
      else if (code === 2) reason = 'unavailable';
      else if (code === 3) reason = 'timeout';
      logGeolocationDebug('watchPosition:error', { reason, apiMessage });
      onResult({ ok: false, position: null, reason, apiMessage });
    },
    opts
  );

  return () => {
    try {
      navigator.geolocation.clearWatch(id);
    } catch {
      // ignora
    }
  };
}
