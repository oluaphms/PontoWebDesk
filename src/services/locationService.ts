/**
 * Serviço de geolocalização para registro de ponto (SmartPonto Antifraude).
 * Captura posição via navigator.geolocation + Permissions API quando disponível.
 */

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp?: number;
}

export interface GetCurrentLocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

const DEFAULT_OPTIONS: GetCurrentLocationOptions = {
  enableHighAccuracy: true,
  timeout: 20000,
  /** Permite reutilizar posição recente (mais rápido e menos falhas em redes lentas) */
  maximumAge: 60000,
};

export type GeolocationFailureReason =
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'unsupported'
  | 'insecure_context';

export type LocationResult =
  | { ok: true; position: GeoPosition }
  | { ok: false; position: null; reason: GeolocationFailureReason; apiMessage?: string };

/** Estado da permissão de geolocalização (Permissions API ou inferido). */
export type GeoPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

function devLog(...args: unknown[]): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof console !== 'undefined') {
    console.info('[Geo]', ...args);
  }
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
  }
): void {
  devLog(phase, data);
}

/**
 * Obtém a localização com motivo de falha (para exibir ao usuário).
 * Força nova leitura do GPS quando maximumAge: 0 (ex.: após “Tentar novamente”).
 */
export function getCurrentLocationResult(options: GetCurrentLocationOptions = {}): Promise<LocationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      logGeolocationDebug('getCurrentPosition', { reason: 'unsupported' });
      resolve({ ok: false, position: null, reason: 'unsupported' });
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
      logGeolocationDebug('insecure_context', { reason: 'insecure_context' });
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
        };
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
        logGeolocationDebug('getCurrentPosition:error', { reason, apiMessage });
        resolve({ ok: false, position: null, reason, apiMessage });
      },
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeout,
        maximumAge: opts.maximumAge ?? 60000,
      }
    );
  });
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
