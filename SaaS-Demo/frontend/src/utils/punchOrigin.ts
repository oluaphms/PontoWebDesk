/**
 * Origem da batida — classificação unificada (Admin, Colaborador, Dashboard, PDF).
 */

export type PunchOriginKind = 'rep' | 'mobile' | 'web' | 'admin' | 'afd' | 'unknown';

type PunchOriginRecord = {
  origin?: string | null;
  source?: string | null;
  source_type?: string | null;
  method?: string | null;
  metadata?: unknown;
  raw_data?: unknown;
  is_manual?: boolean | null;
  manual_reason?: string | null;
  device_id?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location?: unknown;
  nsr?: number | string | null;
};

export type PunchOriginResolved = {
  kind: PunchOriginKind;
  label: string;
  sourceType: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function legacyPayloadHints(r: PunchOriginRecord): { source: string; method: string; origin: string } {
  const containers = [asRecord(r.metadata), asRecord(r.raw_data)].filter((item): item is Record<string, unknown> => item != null);
  for (const container of containers) {
    const payload = asRecord(container.payload);
    const nestedRaw = asRecord(container.raw);
    const candidates = [container, payload, nestedRaw].filter((item): item is Record<string, unknown> => item != null);
    for (const candidate of candidates) {
      const source = readString(candidate.source ?? candidate.origem);
      const method = readString(candidate.method);
      const origin = readString(candidate.origin);
      if (source || method || origin) return { source, method, origin };
    }
  }
  return { source: '', method: '', origin: '' };
}

function readDeviceTypeHint(r: PunchOriginRecord): string {
  const containers = [asRecord(r.metadata), asRecord(r.raw_data)].filter((item): item is Record<string, unknown> => item != null);
  for (const container of containers) {
    const payload = asRecord(container.payload);
    const candidates = [container, payload].filter((item): item is Record<string, unknown> => item != null);
    for (const candidate of candidates) {
      const deviceType = readString(candidate.deviceType ?? candidate.device_type);
      if (deviceType) return deviceType;
    }
  }
  return '';
}

function isColaboradorCaptureMethod(method: string): boolean {
  return method === 'gps' || method === 'foto' || method === 'photo' || method === 'biometric' || method === 'api';
}

function isRepHint(source: string, method: string, origin: string): boolean {
  return origin === 'rep' || source === 'rep' || source === 'clock' || method === 'rep';
}

function isAfdImportHint(source: string, method: string, origin: string, legacy: { source: string }): boolean {
  const values = [source, method, origin, legacy.source];
  return values.some((v) => v === 'afd_import' || v === 'afd import' || v.includes('afd_import'));
}

function hasColaboradorDeviceSignals(r: PunchOriginRecord): boolean {
  const rec = r as Record<string, unknown>;
  if (rec.device_id != null && String(rec.device_id).trim() !== '') return true;
  const lat = Number(rec.latitude);
  const lng = Number(rec.longitude);
  if (Number.isFinite(lat) || Number.isFinite(lng)) return true;
  const loc = asRecord(rec.location);
  if (
    loc &&
    (loc.lat != null || loc.latitude != null || loc.lng != null || loc.longitude != null)
  ) {
    return true;
  }
  if (rec.nsr != null && String(rec.nsr).trim() !== '') return true;
  const deviceType = readDeviceTypeHint(r);
  return deviceType === 'mobile' || deviceType === 'web';
}

function readOriginFields(r: PunchOriginRecord): {
  o: string;
  s: string;
  st: string;
  m: string;
} {
  const legacy = legacyPayloadHints(r);
  return {
    o: readString(r.origin) || legacy.origin,
    s: readString(r.source) || legacy.source,
    st: readString(r.source_type),
    m: readString(r.method) || legacy.method,
  };
}

function readManualReason(r: PunchOriginRecord): string {
  const direct = String(r.manual_reason ?? '').trim();
  if (direct) return direct;
  for (const container of [asRecord(r.metadata), asRecord(r.raw_data)].filter(Boolean)) {
    const fromMeta = String(container?.manual_reason ?? '').trim();
    if (fromMeta) return fromMeta;
  }
  return '';
}

/**
 * Batida registrada pelo próprio colaborador (app/portal/REP com identidade).
 * O RPC do espelho RH usa `source` manual|admin — nunca web|mobile|app.
 */
export function isColaboradorSelfServicePunch(r: PunchOriginRecord): boolean {
  const { o, s, m } = readOriginFields(r);

  // Ajuste RH no espelho (origin=admin + motivo): GPS não vira "app"
  if (o === 'admin' && !isColaboradorCaptureMethod(m) && readManualReason(r)) return false;

  if (s === 'web' || s === 'mobile' || s === 'app') return true;
  if (o === 'mobile' || o === 'app') return true;
  if (isColaboradorCaptureMethod(m)) return true;
  if (hasColaboradorDeviceSignals(r)) return true;
  if (r.is_manual === true && s === 'web' && m === 'manual') return true;

  return false;
}

/** Batida lançada pelo RH/Admin no espelho — não confundir com `method=manual` do colaborador. */
export function isRhAdjustmentOrigin(r: PunchOriginRecord): boolean {
  if (isRepPunchRecord(r)) return false;

  const { o, s, st, m } = readOriginFields(r);

  if (s === 'web' || s === 'mobile' || s === 'app') return false;
  if (isColaboradorCaptureMethod(m)) return false;

  if (o === 'admin') {
    const reason = readManualReason(r);
    if (!reason) return false;
    if (s !== 'manual' && s !== 'admin') return false;
    if (m !== 'manual' && m !== 'admin') return false;
    return true;
  }
  if (s === 'admin' || m === 'admin' || st === 'admin') return true;
  if (s === 'manual' && m === 'admin') return true;
  return false;
}

export function recordPunchInstantIso(r: {
  timestamp?: string | null;
  created_at?: string | null;
}): string {
  const ts = r.timestamp != null && String(r.timestamp).trim() !== '' ? String(r.timestamp).trim() : '';
  if (ts) return ts;
  return String(r.created_at ?? '');
}

export function recordPunchInstantMs(r: {
  timestamp?: string | null;
  created_at?: string | null;
}): number {
  const iso = recordPunchInstantIso(r);
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Relógio / REP / agente de coleta (sem localização válida no modelo). */
export function isRepPunchRecord(r: {
  origin?: string | null;
  source?: string | null;
  method?: string | null;
  metadata?: unknown;
  raw_data?: unknown;
}): boolean {
  const legacy = legacyPayloadHints(r);
  if (isRepHint(legacy.source, legacy.method, legacy.origin)) return true;
  return isRepHint(readString(r.source), readString(r.method), readString(r.origin));
}

export function resolvePunchOrigin(r: PunchOriginRecord): PunchOriginResolved {
  const legacy = legacyPayloadHints(r);
  const o = readString(r.origin) || legacy.origin;
  const s = readString(r.source) || legacy.source;
  const st = readString(r.source_type);
  const m = readString(r.method) || legacy.method;
  const deviceType = readDeviceTypeHint(r);

  if (isAfdImportHint(s, m, o, legacy)) {
    return { kind: 'afd', label: 'Importação AFD', sourceType: 'control_id' };
  }
  if (isRepHint(s, m, o) || st === 'control_id' || st === 'rep') {
    return { kind: 'rep', label: 'Relógio REP', sourceType: 'control_id' };
  }
  if (isColaboradorSelfServicePunch(r)) {
    if (o === 'mobile' || o === 'app' || st === 'app' || deviceType === 'mobile' || s === 'mobile' || s === 'app') {
      return { kind: 'mobile', label: 'Aplicativo', sourceType: 'app' };
    }
    if (s === 'web' || deviceType === 'web') {
      return { kind: 'web', label: 'Portal Web', sourceType: 'app' };
    }
    return { kind: 'mobile', label: 'Aplicativo', sourceType: 'app' };
  }
  if (isRhAdjustmentOrigin(r)) {
    return { kind: 'admin', label: 'Ajuste Manual', sourceType: 'admin' };
  }

  const isMobileOrigin = o === 'mobile' || o === 'app' || st === 'app' || s === 'mobile' || s === 'app' || deviceType === 'mobile';
  const isAppCapture = m === 'gps' || m === 'foto' || m === 'photo' || m === 'biometric';

  if (isMobileOrigin || (s === 'web' && isAppCapture)) {
    return { kind: 'mobile', label: 'Aplicativo', sourceType: 'app' };
  }
  if (s === 'web') {
    return { kind: 'web', label: 'Portal Web', sourceType: 'app' };
  }
  if (isColaboradorCaptureMethod(m)) {
    return { kind: 'mobile', label: 'Aplicativo', sourceType: 'app' };
  }

  return { kind: 'mobile', label: 'Aplicativo', sourceType: 'app' };
}

export function shouldHidePunchLocation(r: {
  origin?: string | null;
  source?: string | null;
  method?: string | null;
}): boolean {
  return isRepPunchRecord(r);
}
