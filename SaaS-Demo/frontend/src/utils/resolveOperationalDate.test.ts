import { describe, expect, it } from 'vitest';
import { buildDayMirrorSummary, type TimeRecord } from './timesheetMirror';
import {
  computeNightAwareWorkedMinutes,
  filterRecordsByOperationalDate,
  getOperationalDate,
  isOpenNightJourney,
  MAX_NIGHT_JOURNEY_MINUTES,
  type DayScheduleSlots,
} from './resolveOperationalDate';
import { filterRecordsForOperationalDay } from '../services/monitoring/monitoringGeoHardLock.service';
import { inferOperationalPresenceForDay } from '../services/monitoring/monitoringGeoHardLock.service';

const nightSchedule: DayScheduleSlots = {
  entrada: '22:00',
  saida_intervalo: '01:00',
  volta_intervalo: '02:00',
  saida_final: '06:00',
  toleranceMin: 60,
};

function tr(partial: Partial<TimeRecord> & Pick<TimeRecord, 'id' | 'timestamp' | 'type'>): TimeRecord {
  return {
    user_id: 'u',
    created_at: partial.created_at ?? partial.timestamp ?? new Date().toISOString(),
    ...partial,
  };
}

const scheduleByDay = (date: string) => (date === '2026-06-17' ? nightSchedule : null);

const ctx = {
  periodStartYmd: '2026-06-16',
  periodEndYmd: '2026-06-19',
  scheduleByDay,
};

describe('resolveOperationalDate — cenários obrigatórios', () => {
  const fullJourney: TimeRecord[] = [
    tr({ id: 'e', timestamp: '2026-06-17T22:00:00.000-03:00', type: 'entrada' }),
    tr({ id: 'si', timestamp: '2026-06-18T01:00:00.000-03:00', type: 'intervalo_saida' }),
    tr({ id: 'vi', timestamp: '2026-06-18T02:00:00.000-03:00', type: 'intervalo_volta' }),
    tr({ id: 'sf', timestamp: '2026-06-18T07:24:00.000-03:00', type: 'saida' }),
  ];

  it('Cenário 1: 22:00, 01:00, 02:00, 07:24 → 1 linha em 17/06', () => {
    for (const r of fullJourney) {
      expect(getOperationalDate(r, ctx)).toBe('2026-06-17');
    }
    const map = buildDayMirrorSummary(fullJourney, '2026-06-17', '2026-06-18', { scheduleByDay });
    const day = map.get('2026-06-17');
    expect(day?.entradaInicio).toBe('22:00');
    expect(day?.saidaIntervalo).toBe('01:00');
    expect(day?.voltaIntervalo).toBe('02:00');
    expect(day?.saidaFinal).toBe('07:24');
    expect(map.get('2026-06-18')?.records.filter((r) => !String(r.type).includes('status')).length ?? 0).toBe(0);
    expect(computeNightAwareWorkedMinutes('2026-06-17', '22:00', '07:24', '01:00', '02:00')).toBeGreaterThan(0);
  });

  it('Cenário 2: 22:00 + 06:00 → 1 linha em 17/06', () => {
    const records = [
      tr({ id: 'e', timestamp: '2026-06-17T22:00:00.000-03:00', type: 'entrada' }),
      tr({ id: 's', timestamp: '2026-06-18T06:00:00.000-03:00', type: 'saida' }),
    ];
    const filtered = filterRecordsByOperationalDate(records, '2026-06-17', ctx);
    expect(filtered).toHaveLength(2);
  });

  it('Cenário 3: 22:00 + 08:30 → 1 linha (dentro do cap 12h)', () => {
    const records = [
      tr({ id: 'e', timestamp: '2026-06-17T22:00:00.000-03:00', type: 'entrada' }),
      tr({ id: 's', timestamp: '2026-06-18T08:30:00.000-03:00', type: 'saida' }),
    ];
    expect(getOperationalDate(records[1]!, ctx)).toBe('2026-06-17');
  });

  it('Cenário 4: 22:00 + 12:00 → nova jornada em 18/06', () => {
    const records = [
      tr({ id: 'e', timestamp: '2026-06-17T22:00:00.000-03:00', type: 'entrada' }),
      tr({ id: 's', timestamp: '2026-06-18T12:00:00.000-03:00', type: 'saida' }),
    ];
    expect(getOperationalDate(records[1]!, ctx)).toBe('2026-06-18');
  });
});

describe('resolveOperationalDate — monitoramento e dashboard', () => {
  it('Cenário 5: jornada aberta após meia-noite não gera ausência (entrada ontem + batida hoje)', () => {
    const nowMs = new Date('2026-06-18T02:00:00.000-03:00').getTime();
    const records = [
      {
        id: 'e',
        user_id: 'u1',
        type: 'entrada',
        created_at: '2026-06-18T01:00:00.000Z',
        timestamp: '2026-06-17T22:00:00.000-03:00',
      },
      {
        id: 'si',
        user_id: 'u1',
        type: 'intervalo_saida',
        created_at: '2026-06-18T04:00:00.000Z',
        timestamp: '2026-06-18T01:00:00.000-03:00',
      },
    ];
    expect(isOpenNightJourney([records[0]!], nowMs)).toBe(true);
    const today = filterRecordsForOperationalDay(records, '2026-06-18', { includeOpenNightJourney: true });
    expect(today.some((r) => r.id === 'e')).toBe(true);
    expect(today.some((r) => r.id === 'si')).toBe(true);
  });

  it('Cenário 6: colaborador continua trabalhando após meia-noite', () => {
    const records = [
      {
        id: 'e',
        user_id: 'u1',
        type: 'entrada',
        created_at: '2026-06-18T01:00:00.000Z',
        timestamp: '2026-06-17T22:00:00.000-03:00',
      },
      {
        id: 'w',
        user_id: 'u1',
        type: 'intervalo_volta',
        created_at: '2026-06-18T05:00:00.000Z',
        timestamp: '2026-06-18T02:00:00.000-03:00',
      },
    ];
    const dayRecords = filterRecordsForOperationalDay(records, '2026-06-18', { includeOpenNightJourney: true });
    const presence = inferOperationalPresenceForDay(dayRecords);
    expect(presence.status).toBe('working');
  });
});

describe('resolveOperationalDate — constantes', () => {
  it('cap de jornada noturna = 12 horas', () => {
    expect(MAX_NIGHT_JOURNEY_MINUTES).toBe(720);
  });
});
