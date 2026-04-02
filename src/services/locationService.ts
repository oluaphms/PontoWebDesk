/**
 * Serviço de geolocalização para registro de ponto (SmartPonto Antifraude).
 * Captura posição via navigator.geolocation.
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

export type GeolocationFailureReason = 'denied' | 'timeout' | 'unavailable' | 'unsupported';

export type LocationResult =
  | { ok: true; position: GeoPosition }
  | { ok: false; position: null; reason: GeolocationFailureReason };

/** Mensagem amigável para o usuário (PT-BR). */
export function geolocationReasonMessage(reason: GeolocationFailureReason): string {
  switch (reason) {
    case 'denied':
      return 'Permissão de localização negada. Abra as configurações do navegador e permita a localização para este site.';
    case 'timeout':
      return 'Tempo esgotado ao obter o GPS. Verifique se o GPS está ligado e tente novamente.';
    case 'unavailable':
      return 'Não foi possível obter a posição (posição indisponível). Tente ao ar livre ou ative o GPS.';
    case 'unsupported':
      return 'Este navegador não suporta geolocalização.';
    default:
      return 'Não foi possível obter a localização.';
  }
}

/**
 * Obtém a localização com motivo de falha (para exibir ao usuário).
 */
export function getCurrentLocationResult(options: GetCurrentLocationOptions = {}): Promise<LocationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, position: null, reason: 'unsupported' });
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
      resolve({ ok: false, position: null, reason: 'unavailable' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
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
        if (code === 1) resolve({ ok: false, position: null, reason: 'denied' });
        else if (code === 2) resolve({ ok: false, position: null, reason: 'unavailable' });
        else if (code === 3) resolve({ ok: false, position: null, reason: 'timeout' });
        else resolve({ ok: false, position: null, reason: 'unavailable' });
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
export function getCurrentLocation(
  options: GetCurrentLocationOptions = {}
): Promise<GeoPosition | null> {
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
    onResult({ ok: false, position: null, reason: 'unavailable' });
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
      let reason: GeolocationFailureReason = 'unavailable';
      if (code === 1) reason = 'denied';
      else if (code === 2) reason = 'unavailable';
      else if (code === 3) reason = 'timeout';
      onResult({ ok: false, position: null, reason });
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
