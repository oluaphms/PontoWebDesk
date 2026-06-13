import { describe, expect, it } from 'vitest';
import type { RawTimeRecord } from './timeProcessingService';
import {
  expectedMinutesFromSchedule,
  filterRecordsByJourneyDate,
  type WorkScheduleInfo,
} from './timeProcessingService';
import type { DayScheduleSlots } from '../utils/timesheetMirror';

function raw(partial: Partial<RawTimeRecord> & Pick<RawTimeRecord, 'id' | 'timestamp' | 'type'>): RawTimeRecord {
  return {
    created_at: partial.created_at ?? partial.timestamp ?? new Date().toISOString(),
    ...partial,
  };
}

describe('jornada noturna — motor (shift date)', () => {
  const nightSchedule: DayScheduleSlots = {
    entrada: '22:00',
    saida_intervalo: '01:00',
    volta_intervalo: '02:00',
    saida_final: '06:00',
    toleranceMin: 60,
  };

  const nightRecords: RawTimeRecord[] = [
    raw({ id: 'e1', timestamp: '2026-06-09T22:00:00.000-03:00', type: 'entrada' }),
    raw({ id: 's1', timestamp: '2026-06-10T01:00:00.000-03:00', type: 'intervalo_saida' }),
    raw({ id: 'v1', timestamp: '2026-06-10T02:00:00.000-03:00', type: 'intervalo_volta' }),
    raw({ id: 'sf', timestamp: '2026-06-10T06:00:00.000-03:00', type: 'saida' }),
  ];

  const scheduleByDay = (date: string): DayScheduleSlots | null =>
    date === '2026-06-09' ? nightSchedule : null;

  it('Teste 1: 22:00–06:00 — todas as batidas na jornada de 10/06', () => {
    const journey = filterRecordsByJourneyDate(
      nightRecords,
      '2026-06-09',
      '2026-06-08',
      '2026-06-10',
      scheduleByDay,
    );
    expect(journey.map((r) => r.id)).toEqual(['e1', 's1', 'v1', 'sf']);
    const nextDay = filterRecordsByJourneyDate(
      nightRecords,
      '2026-06-10',
      '2026-06-08',
      '2026-06-10',
      scheduleByDay,
    );
    expect(nextDay).toHaveLength(0);
  });

  it('Teste 2: 18:00–06:00 — batidas pós-meia-noite no dia anterior', () => {
    const schedule18: DayScheduleSlots = {
      entrada: '18:00',
      saida_intervalo: '00:30',
      volta_intervalo: '01:30',
      saida_final: '06:00',
      toleranceMin: 60,
    };
    const records: RawTimeRecord[] = [
      raw({ id: 'e', timestamp: '2026-06-09T18:00:00.000-03:00', type: 'entrada' }),
      raw({ id: 'si', timestamp: '2026-06-10T00:30:00.000-03:00', type: 'intervalo_saida' }),
      raw({ id: 'vi', timestamp: '2026-06-10T01:30:00.000-03:00', type: 'intervalo_volta' }),
      raw({ id: 's', timestamp: '2026-06-10T06:00:00.000-03:00', type: 'saida' }),
    ];
    const byDay = (date: string): DayScheduleSlots | null =>
      date === '2026-06-09' ? schedule18 : null;
    const journey = filterRecordsByJourneyDate(records, '2026-06-09', '2026-06-08', '2026-06-10', byDay);
    expect(journey).toHaveLength(4);
  });

  it('Teste 3: 19:00–07:00 (12x36 noturna) — jornada única', () => {
    const schedule12x36: DayScheduleSlots = {
      entrada: '19:00',
      saida_intervalo: '23:00',
      volta_intervalo: '00:00',
      saida_final: '07:00',
      toleranceMin: 60,
    };
    const records: RawTimeRecord[] = [
      raw({ id: 'e', timestamp: '2026-06-09T19:00:00.000-03:00', type: 'entrada' }),
      raw({ id: 'si', timestamp: '2026-06-09T23:00:00.000-03:00', type: 'intervalo_saida' }),
      raw({ id: 'vi', timestamp: '2026-06-10T00:00:00.000-03:00', type: 'intervalo_volta' }),
      raw({ id: 's', timestamp: '2026-06-10T07:00:00.000-03:00', type: 'saida' }),
    ];
    const byDay = (date: string): DayScheduleSlots | null =>
      date === '2026-06-09' ? schedule12x36 : null;
    const journey = filterRecordsByJourneyDate(records, '2026-06-09', '2026-06-08', '2026-06-10', byDay);
    expect(journey).toHaveLength(4);
  });

  it('Teste 4: jornada diurna — sem alteração (dia civil)', () => {
    const daySchedule: DayScheduleSlots = {
      entrada: '08:00',
      saida_intervalo: '12:00',
      volta_intervalo: '13:00',
      saida_final: '18:00',
      toleranceMin: 60,
    };
    const records: RawTimeRecord[] = [
      raw({ id: 'e', timestamp: '2026-06-10T08:00:00.000-03:00', type: 'entrada' }),
      raw({ id: 'si', timestamp: '2026-06-10T12:00:00.000-03:00', type: 'intervalo_saida' }),
      raw({ id: 'vi', timestamp: '2026-06-10T13:00:00.000-03:00', type: 'intervalo_volta' }),
      raw({ id: 's', timestamp: '2026-06-10T18:00:00.000-03:00', type: 'saida' }),
    ];
    const byDay = (date: string): DayScheduleSlots | null =>
      date === '2026-06-10' ? daySchedule : null;
    const journey = filterRecordsByJourneyDate(records, '2026-06-10', '2026-06-09', '2026-06-10', byDay);
    expect(journey).toHaveLength(4);
  });

  it('expectedMinutesFromSchedule — turno 22:00–06:00 com intervalo 01:00–02:00 = 7h', () => {
    const schedule: WorkScheduleInfo = {
      start_time: '22:00',
      end_time: '06:00',
      break_start: '01:00',
      break_end: '02:00',
      tolerance_minutes: 60,
      daily_hours: 8,
      work_days: [1, 2, 3, 4, 5],
    };
    expect(expectedMinutesFromSchedule(schedule)).toBe(420);
  });
});
