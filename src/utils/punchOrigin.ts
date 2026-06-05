/**
 * Origem da batida (relógio vs app) — alinha `source`/`method` legados com campos `origin`/`source_type` (migração).
 */

export type PunchOriginKind = 'rep' | 'mobile' | 'admin' | 'unknown';

type PunchOriginRecord = {
  origin?: string | null;
  source?: string | null;
  source_type?: string | null;
  method?: string | null;
  metadata?: unknown;
  raw_data?: unknown;
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
      const source = readString(candidate.source);
      const method = readString(candidate.method);
      const origin = readString(candidate.origin);
      if (source || method || origin) return { source, method, origin };
    }
  }
  return { source: '', method: '', origin: '' };
}

function isMobileHint(source: string, method: string, origin: string): boolean {
  return (
    origin === 'mobile' ||
    origin === 'app' ||
    source === 'web' ||
    source === 'mobile' ||
    source === 'app' ||
    method === 'gps' ||
    method === 'foto' ||
    method === 'photo' ||
    method === 'biometric'
  );
}

function isRepHint(source: string, method: string, origin: string): boolean {
  return origin === 'rep' || source === 'rep' || source === 'clock' || method === 'rep';
}

function isAdminHint(source: string, method: string, origin: string): boolean {
  return origin === 'admin' || source === 'admin' || source === 'manual' || method === 'admin' || method === 'manual';
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

export function resolvePunchOrigin(r: PunchOriginRecord): { kind: PunchOriginKind; label: string; sourceType: string } {
  const legacy = legacyPayloadHints(r);
  if (isMobileHint(legacy.source, legacy.method, legacy.origin)) {
    return { kind: 'mobile', label: 'App', sourceType: 'app' };
  }
  if (isRepHint(legacy.source, legacy.method, legacy.origin)) {
    return { kind: 'rep', label: 'Relógio', sourceType: 'control_id' };
  }

  const o = readString(r.origin);
  const s = readString(r.source);
  const st = readString(r.source_type);
  const m = readString(r.method);
  if (isRepHint(s, m, o) || st === 'control_id' || st === 'rep') {
    return { kind: 'rep', label: 'Relógio', sourceType: 'control_id' };
  }
  if (isAdminHint(s, m, o) || st === 'admin' || st === 'manual') {
    return { kind: 'admin', label: 'Manual / RH', sourceType: 'app' };
  }
  if (isMobileHint(s, m, o) || st === 'app') {
    return { kind: 'mobile', label: 'App', sourceType: 'app' };
  }
  return { kind: 'mobile', label: 'App', sourceType: 'app' };
}

export function shouldHidePunchLocation(r: {
  origin?: string | null;
  source?: string | null;
  method?: string | null;
}): boolean {
  return isRepPunchRecord(r);
}
