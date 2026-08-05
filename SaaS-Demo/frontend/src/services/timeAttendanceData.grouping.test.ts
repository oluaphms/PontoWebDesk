import { describe, expect, it } from 'vitest';
import type { RawTimeRecord } from './timeProcessingService';
import { buildScheduleByDayLookup } from './timeProcessingService';
import { buildDayMirrorSummary } from '../utils/timesheetMirror';
import { journeyDayForAttendanceRecord } from './timeAttendanceData';

function raw(partial: Partial<RawTimeRecord> & Pick<RawTimeRecord, 'id' | 'timestamp' | 'type'>): RawTimeRecord {
  return {
    created_at: partial.created_at ?? partial.timestamp ?? new Date().toISOString(),
    user_id: 'u1',
    ...partial,
  };
}

describe('Jornada de Trabalho — agrupamento alinhado ao Espelho', () => {
  const nightWindowByDow = {
    0: null,
    1: null,
    2: {
      entrada: '22:00',
      saida: '06:00',
      saida_intervalo: '01:00',
      volta_intervalo: '02:00',
      toleranceMin: 60,
    },
    3: null,
    4: null,
    5: null,
    6: null,
  };

  const records: RawTimeRecord[] = [
    raw({ id: 'e1', timestamp: '2026-06-09T22:00:00.000-03:00', type: 'entrada' }),
    raw({ id: 's1', timestamp: '2026-06-10T01:00:00.000-03:00', type: 'intervalo_saida' }),
    raw({ id: 'v1', timestamp: '2026-06-10T02:00:00.000-03:00', type: 'intervalo_volta' }),
    raw({ id: 'sf', timestamp: '2026-06-10T06:00:00.000-03:00', type: 'saida' }),
  ];

  it('Cenário 2: jornada noturna — mesma data que o Espelho (10/06)', () => {
    const scheduleByDay = buildScheduleByDayLookup(nightWindowByDow);
    const periodStart = '2026-06-08';
    const periodEnd = '2026-06-10';

    const journeyDays = records.map((r) =>
      journeyDayForAttendanceRecord(r, periodStart, periodEnd, scheduleByDay),
    );
    expect(journeyDays).toEqual(['2026-06-09', '2026-06-09', '2026-06-09', '2026-06-09']);

    const mirror = buildDayMirrorSummary(records as never[], '2026-06-09', '2026-06-10', {
      scheduleByDay: (date) => scheduleByDay(date),
    });
    expect(mirror.get('2026-06-09')?.records).toHaveLength(4);
    expect(mirror.get('2026-06-10')?.records.filter((r) => r.type !== 'status').length ?? 0).toBe(0);
  });

  it('Cenário 1: jornada diurna — agrupamento civil inalterado', () => {
    const dayWindowByDow = {
      0: null,
      1: null,
      2: {
        entrada: '08:00',
        saida: '18:00',
        saida_intervalo: '12:00',
        volta_intervalo: '13:00',
        toleranceMin: 60,
      },
      3: null,
      4: null,
      5: null,
      6: null,
    };
    const dayRecords: RawTimeRecord[] = [
      raw({ id: 'e', timestamp: '2026-06-10T08:00:00.000-03:00', type: 'entrada' }),
      raw({ id: 'si', timestamp: '2026-06-10T12:00:00.000-03:00', type: 'intervalo_saida' }),
      raw({ id: 'vi', timestamp: '2026-06-10T13:00:00.000-03:00', type: 'intervalo_volta' }),
      raw({ id: 's', timestamp: '2026-06-10T18:00:00.000-03:00', type: 'saida' }),
    ];
    const scheduleByDay = buildScheduleByDayLookup(dayWindowByDow);
    const days = dayRecords.map((r) =>
      journeyDayForAttendanceRecord(r, '2026-06-09', '2026-06-10', scheduleByDay),
    );
    expect(days.every((d) => d === '2026-06-10')).toBe(true);
  });
});
