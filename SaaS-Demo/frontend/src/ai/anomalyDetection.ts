/**
 * Detecção de anomalias comportamentais no registro de ponto (SmartPonto).
 * Analisa histórico do funcionário: horários médios, localização, dispositivos, jornada.
 */

export interface TimeRecordForAnomaly {
  type: string;
  timestamp: string;
  latitude?: number | null;
  longitude?: number | null;
  device_id?: string | null;
  created_at?: string;
}

export interface EmployeePattern {
  avgEntryTime?: string;
  avgExitTime?: string;
  avgWorkMinutes?: number;
  commonDeviceIds?: string[];
  commonLat?: number;
  commonLon?: number;
  totalRecords?: number;
}

export interface AnomalyDetectionInput {
  employeeId: string;
  companyId: string;
  type: string;
  timestamp: Date;
  latitude?: number | null;
  longitude?: number | null;
  deviceId?: string | null;
  history: TimeRecordForAnomaly[];
}

export interface AnomalyDetectionResult {
  isAnomaly: boolean;
  behaviorAnomaly: boolean;
  reasons: string[];
  pattern?: EmployeePattern;
}

const MAX_WORK_MINUTES_DAY = 16 * 60;
const ENTRY_DEVIATION_MINUTES = 3 * 60;
const LOCATION_KM_THRESHOLD = 50;
const REPEAT_PUNCH_MINUTES = 2;

function parseTime(timestamp: string): Date {
  return new Date(timestamp);
}

function timeToMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function extractEntryExitPairs(history: TimeRecordForAnomaly[]): { entry: Date; exit: Date }[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp || a.created_at || 0).getTime() - new Date(b.timestamp || b.created_at || 0).getTime()
  );
  const pairs: { entry: Date; exit: Date }[] = [];
  let lastEntry: Date | null = null;

  for (const r of sorted) {
    const t = parseTime(r.timestamp || (r.created_at as string) || '');
    if (r.type === 'entrada') lastEntry = t;
    else if ((r.type === 'saída' || r.type === 'saida') && lastEntry) {
      pairs.push({ entry: lastEntry, exit: t });
      lastEntry = null;
    }
  }
  return pairs;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Detecta padrão comportamental do funcionário a partir do histórico.
 */
export function detectBehaviorPattern(history: TimeRecordForAnomaly[]): EmployeePattern | null {
  if (!history?.length) return null;

  const pairs = extractEntryExitPairs(history);
  const entries: number[] = [];
  const exits: number[] = [];
  const workMinutes: number[] = [];
  const deviceIds: string[] = [];
  const lats: number[] = [];
  const lons: number[] = [];

  for (const p of pairs) {
    entries.push(timeToMinutes(p.entry));
    exits.push(timeToMinutes(p.exit));
    workMinutes.push((p.exit.getTime() - p.entry.getTime()) / 60000);
  }

  for (const r of history) {
    if (r.device_id) deviceIds.push(r.device_id);
    if (r.latitude != null && r.longitude != null) {
      lats.push(r.latitude);
      lons.push(r.longitude);
    }
  }

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const avgEntry = entries.length ? avg(entries) : undefined;
  const avgExit = exits.length ? avg(exits) : undefined;
  const avgWork = workMinutes.length ? avg(workMinutes) : undefined;

  const deviceCount: Record<string, number> = {};
  deviceIds.forEach((id) => {
    deviceCount[id] = (deviceCount[id] || 0) + 1;
  });
  const commonDeviceIds = Object.entries(deviceCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  return {
    avgEntryTime:
      avgEntry != null
        ? `${Math.floor(avgEntry / 60)}:${String(Math.round(avgEntry % 60)).padStart(2, '0')}`
        : undefined,
    avgExitTime:
      avgExit != null
        ? `${Math.floor(avgExit / 60)}:${String(Math.round(avgExit % 60)).padStart(2, '0')}`
        : undefined,
    avgWorkMinutes: avgWork != null ? Math.round(avgWork) : undefined,
    commonDeviceIds: commonDeviceIds.length ? commonDeviceIds : undefined,
    commonLat: lats.length ? avg(lats) : undefined,
    commonLon: lons.length ? avg(lons) : undefined,
    totalRecords: history.length,
  };
}

/**
 * Verifica se o registro atual é anomalia em relação ao padrão.
 */
export function detectBehaviorAnomaly(input: AnomalyDetectionInput): AnomalyDetectionResult {
  const reasons: string[] = [];
  const pattern = detectBehaviorPattern(input.history);
  const currentMinutes = timeToMinutes(input.timestamp);

  if (input.type === 'entrada' && pattern?.avgEntryTime) {
    const [h, m] = pattern.avgEntryTime.split(':').map(Number);
    const avgEntryMinutes = h * 60 + m;
    if (Math.abs(currentMinutes - avgEntryMinutes) > ENTRY_DEVIATION_MINUTES) {
      reasons.push('Horário de entrada muito diferente do padrão');
    }
  }

  if (input.type === 'saída' || input.type === 'saida') {
    const todayRecords = input.history.filter((r) => {
      const d = new Date(r.timestamp || (r.created_at as string) || '');
      return d.toDateString() === input.timestamp.toDateString();
    });
    const pairs = extractEntryExitPairs(todayRecords);
    const totalMinutes = pairs.reduce(
      (acc, p) => acc + (p.exit.getTime() - p.entry.getTime()) / 60000,
      0
    );
    if (totalMinutes > MAX_WORK_MINUTES_DAY) {
      reasons.push('Jornada superior a 16 horas no mesmo dia');
    }
  }

  if (input.latitude != null && input.longitude != null && pattern?.commonLat != null && pattern?.commonLon != null) {
    const km = haversineKm(
      input.latitude,
      input.longitude,
      pattern.commonLat,
      pattern.commonLon
    );
    if (km > LOCATION_KM_THRESHOLD) {
      reasons.push(`Registro a ${Math.round(km)} km do local habitual`);
    }
  }

  if (input.deviceId && pattern?.commonDeviceIds?.length) {
    if (!pattern.commonDeviceIds.includes(input.deviceId)) {
      reasons.push('Dispositivo diferente do habitual');
    }
  }

  const lastSameDay = input.history
    .filter(
      (r) =>
        new Date(r.timestamp || (r.created_at as string) || '').toDateString() ===
        input.timestamp.toDateString() && r.type === input.type
    )
    .sort(
      (a, b) =>
        new Date(b.timestamp || (b.created_at as string) || 0).getTime() -
        new Date(a.timestamp || (a.created_at as string) || 0).getTime()
    );
  if (lastSameDay.length > 0) {
    const last = new Date(lastSameDay[0].timestamp || (lastSameDay[0].created_at as string) || '');
    const diffMin = Math.abs(input.timestamp.getTime() - last.getTime()) / 60000;
    if (diffMin < REPEAT_PUNCH_MINUTES) {
      reasons.push('Registro repetido em curto intervalo');
    }
  }

  const behaviorAnomaly = reasons.length > 0;

  return {
    isAnomaly: behaviorAnomaly,
    behaviorAnomaly,
    reasons,
    pattern: pattern || undefined,
  };
}
