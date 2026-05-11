import { describe, it, expect } from 'vitest';
import { calendarDateForEspelhoRow } from './calendarUtils';
import {
  buildDayMirrorSummary,
  normalizeRecordTypeForMirror,
  recordEffectiveMirrorInstant,
  recordMirrorInstant,
  type TimeRecord,
} from './timesheetMirror';

function tr(p: Partial<TimeRecord> & Pick<TimeRecord, 'id' | 'user_id' | 'created_at' | 'type'>): TimeRecord {
  return {
    id: p.id,
    user_id: p.user_id,
    created_at: p.created_at,
    timestamp: p.timestamp ?? null,
    type: p.type,
    manual_reason: p.manual_reason ?? null,
    source: p.source ?? null,
    method: p.method ?? null,
  };
}

describe('normalizeRecordTypeForMirror', () => {
  it('trata saída (PostgreSQL) como saida', () => {
    expect(normalizeRecordTypeForMirror('saída')).toBe('saida');
    expect(normalizeRecordTypeForMirror('SAÍDA')).toBe('saida');
  });

  it('mapeia pausa para intervalo de saída', () => {
    expect(normalizeRecordTypeForMirror('pausa')).toBe('intervalo_saida');
  });
});

describe('recordMirrorInstant', () => {
  it('prioriza timestamp sobre created_at', () => {
    const r = tr({
      id: '1',
      user_id: 'u',
      created_at: '2026-04-04T10:00:00.000Z',
      timestamp: '2026-04-04T08:00:00.000-03:00',
      type: 'entrada',
    });
    expect(recordMirrorInstant(r)).toBe('2026-04-04T08:00:00.000-03:00');
  });
});

describe('espelho: timestamp AFD fora do período + importação no período', () => {
  it('calendarDateForEspelhoRow agrupa pelo dia de created_at quando o instante oficial cai fora do período', () => {
    const r = tr({
      id: '1',
      user_id: 'u',
      created_at: '2026-04-16T14:29:35.829Z',
      timestamp: '2019-01-30T17:37:01.000Z',
      type: 'entrada',
    });
    const day = calendarDateForEspelhoRow(r, '2026-04-01', '2026-04-30');
    expect(day >= '2026-04-01' && day <= '2026-04-30').toBe(true);
  });

  it('recordEffectiveMirrorInstant preserva horário de parede do timestamp no dia da grelha', () => {
    const r = tr({
      id: '1',
      user_id: 'u',
      created_at: '2026-04-16T14:29:35.829Z',
      timestamp: '2019-01-30T17:37:01.000Z',
      type: 'entrada',
    });
    const gridDay = calendarDateForEspelhoRow(r, '2026-04-01', '2026-04-30');
    const eff = recordEffectiveMirrorInstant(r, gridDay);
    const wall = new Date(r.timestamp!);
    const effDate = new Date(eff);
    expect(effDate.getHours()).toBe(wall.getHours());
    expect(effDate.getMinutes()).toBe(wall.getMinutes());
  });
});

describe('buildDayMirrorSummary — ordem cronológica (sem promoção REP>APP)', () => {
  it('coluna Entrada segue a 1ª batida cronológica (APP antes do REP)', () => {
    const day = '2026-04-20';
    const records: TimeRecord[] = [
      tr({
        id: 'm',
        user_id: 'u',
        created_at: `${day}T12:00:00.000Z`,
        timestamp: `${day}T08:00:00.000-03:00`,
        type: 'entrada',
        source: 'web',
      }),
      tr({
        id: 'r',
        user_id: 'u',
        created_at: `${day}T11:00:00.000Z`,
        timestamp: `${day}T08:03:00.000-03:00`,
        type: 'entrada',
        source: 'rep',
        method: 'rep',
      }),
    ];
    const map = buildDayMirrorSummary(records, day, day);
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('08:00');
    expect(dm?.saidaIntervalo).toBe('08:03');
    expect(dm?.slotRecordIds?.entrada).toBe('m');
    expect(dm?.mirrorAudit?.some((e) => e.kind === 'TIME RECORD ENTRY OVERWRITE BLOCKED' && e.record_id === 'r')).toBe(
      true,
    );
  });

  it('infere «Saída int.» quando a 2ª batida é entrada no app (deveria ser pausa) após entrada do relógio', () => {
    const day = '2026-04-20';
    const records: TimeRecord[] = [
      tr({
        id: 'r',
        user_id: 'u',
        created_at: `${day}T12:00:00.000Z`,
        timestamp: `${day}T08:03:00.000-03:00`,
        type: 'entrada',
        source: 'rep',
        method: 'rep',
      }),
      tr({
        id: 'm',
        user_id: 'u',
        created_at: `${day}T15:00:00.000Z`,
        timestamp: `${day}T12:00:00.000-03:00`,
        type: 'entrada',
        source: 'web',
      }),
    ];
    const map = buildDayMirrorSummary(records, day, day);
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('08:03');
    expect(dm?.saidaIntervalo).toBe('12:00');
  });

  it('«pausa» no relógio após saída de intervalo preenche Volta intervalo (não sobrescreve Saída int.)', () => {
    const day = '2026-04-20';
    const records: TimeRecord[] = [
      tr({
        id: '1',
        user_id: 'u',
        created_at: `${day}T11:00:00.000Z`,
        timestamp: `${day}T08:03:00.000-03:00`,
        type: 'entrada',
        source: 'rep',
        method: 'rep',
      }),
      tr({
        id: '2',
        user_id: 'u',
        created_at: `${day}T15:00:00.000Z`,
        timestamp: `${day}T12:00:00.000-03:00`,
        type: 'saída',
        source: 'web',
      }),
      tr({
        id: '3',
        user_id: 'u',
        created_at: `${day}T17:00:00.000Z`,
        timestamp: `${day}T14:00:00.000-03:00`,
        type: 'pausa',
        source: 'rep',
        method: 'rep',
      }),
      tr({
        id: '4',
        user_id: 'u',
        created_at: `${day}T19:30:00.000Z`,
        timestamp: `${day}T16:19:00.000-03:00`,
        type: 'saída',
        source: 'web',
      }),
    ];
    const map = buildDayMirrorSummary(records, day, day);
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('08:03');
    expect(dm?.saidaIntervalo).toBe('12:00');
    expect(dm?.voltaIntervalo).toBe('14:00');
    expect(dm?.saidaFinal).toBe('16:19');
  });

  it('remove duplicata REP de entrada no mesmo minuto para não repetir horário no espelho', () => {
    const day = '2026-04-21';
    const records: TimeRecord[] = [
      tr({
        id: 'rep-e-1',
        user_id: 'u',
        created_at: `${day}T10:14:00.000Z`,
        timestamp: `${day}T07:14:00.000-03:00`,
        type: 'entrada',
        source: 'rep',
        method: 'rep',
      }),
      tr({
        id: 'rep-e-dup',
        user_id: 'u',
        created_at: `${day}T10:14:01.000Z`,
        timestamp: `${day}T07:14:00.000-03:00`,
        type: 'entrada',
        source: 'rep',
        method: 'rep',
      }),
      tr({
        id: 'rep-s-1',
        user_id: 'u',
        created_at: `${day}T15:09:00.000Z`,
        timestamp: `${day}T12:09:00.000-03:00`,
        type: 'pausa',
        source: 'rep',
        method: 'rep',
      }),
    ];

    const map = buildDayMirrorSummary(records, day, day);
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('07:14');
    expect(dm?.saidaIntervalo).toBe('12:09');
    expect(dm?.voltaIntervalo).toBeNull();
    expect(dm?.saidaFinal).toBeNull();
  });

  it('com 3 batidas REP (entrada, saída int., volta) mantém 3ª em Volta int. e não em Saída', () => {
    const day = '2026-04-23';
    const records: TimeRecord[] = [
      tr({
        id: 'r1',
        user_id: 'u',
        created_at: `${day}T10:14:00.000Z`,
        timestamp: `${day}T07:14:00.000-03:00`,
        type: 'entrada',
        source: 'rep',
        method: 'rep',
      }),
      tr({
        id: 'r2',
        user_id: 'u',
        created_at: `${day}T15:09:00.000Z`,
        timestamp: `${day}T12:09:00.000-03:00`,
        type: 'saída',
        source: 'rep',
        method: 'rep',
      }),
      tr({
        id: 'r3',
        user_id: 'u',
        created_at: `${day}T17:04:00.000Z`,
        timestamp: `${day}T14:04:00.000-03:00`,
        type: 'saída',
        source: 'rep',
        method: 'rep',
      }),
    ];
    const map = buildDayMirrorSummary(records, day, day);
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('07:14');
    expect(dm?.saidaIntervalo).toBe('12:09');
    expect(dm?.voltaIntervalo).toBe('14:04');
    expect(dm?.saidaFinal).toBeNull();
  });

});

describe('buildDayMirrorSummary — classificação por jornada (proximidade)', () => {
  const day = '2026-04-24';
  const schedule = {
    entrada: '08:00',
    saida_intervalo: '12:00',
    volta_intervalo: '14:00',
    saida_final: '18:00',
    toleranceMin: 60,
  };

  const mk = (id: string, hhmm: string): TimeRecord =>
    tr({
      id,
      user_id: 'u',
      created_at: `${day}T00:00:00.000Z`,
      timestamp: `${day}T${hhmm}:00.000-03:00`,
      type: 'saida',
      source: 'rep',
      method: 'rep',
    });

  it('1ª batida do dia ocupa sempre Entrada (com escala: fora do ref. de intervalo volta → inconsistência)', () => {
    const map = buildDayMirrorSummary([mk('1', '13:50')], day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('13:50');
    expect(dm?.saidaIntervalo).toBeNull();
    expect(dm?.voltaIntervalo).toBeNull();
    expect(dm?.saidaFinal).toBeNull();
    expect(dm?.inconsistencias.map((r) => r.id)).toEqual(['1']);
  });

  it('1ª batida em 14:02 → Entrada; escala sinaliza desvio em relação à entrada esperada', () => {
    const map = buildDayMirrorSummary([mk('1', '14:02')], day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('14:02');
    expect(dm?.saidaIntervalo).toBeNull();
    expect(dm?.voltaIntervalo).toBeNull();
    expect(dm?.saidaFinal).toBeNull();
    expect(dm?.inconsistencias.length).toBeGreaterThan(0);
  });

  it('1ª batida em 11:55 → Entrada (não força slot por proximidade à escala)', () => {
    const map = buildDayMirrorSummary([mk('1', '11:55')], day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('11:55');
    expect(dm?.saidaIntervalo).toBeNull();
    expect(dm?.voltaIntervalo).toBeNull();
    expect(dm?.inconsistencias.length).toBeGreaterThan(0);
  });

  it('fora da tolerância da escala marca inconsistência sem mudar a coluna (1ª batida = Entrada)', () => {
    const map = buildDayMirrorSummary([mk('1', '22:30')], day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('22:30');
    expect(dm?.saidaIntervalo).toBeNull();
    expect(dm?.voltaIntervalo).toBeNull();
    expect(dm?.saidaFinal).toBeNull();
    expect(dm?.inconsistencias.map((r) => r.id)).toEqual(['1']);
  });

  it('duas batidas: ordem cronológica 13:50 → Entrada, 14:02 → Saída int.; sem reutilizar o mesmo record_id', () => {
    const records = [mk('1', '14:02'), mk('2', '13:50')];
    const map = buildDayMirrorSummary(records, day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('13:50');
    expect(dm?.saidaIntervalo).toBe('14:02');
    expect(dm?.slotRecordIds?.entrada).toBe('2');
    expect(dm?.slotRecordIds?.saida_intervalo).toBe('1');
    expect(dm?.batidasExtra).toHaveLength(0);
  });

  it('tipo explícito manda na coluna mesmo fora da tolerância da escala (entrada cedo)', () => {
    const records = [
      tr({
        id: 'e1',
        user_id: 'u',
        created_at: `${day}T12:00:00.000Z`,
        timestamp: `${day}T06:02:00.000-03:00`,
        type: 'entrada',
        source: 'mobile',
      }),
    ];
    const map = buildDayMirrorSummary(records, day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('06:02');
    expect(dm?.saidaIntervalo).toBeNull();
    expect(dm?.inconsistencias.map((r) => r.id)).toEqual(['e1']);
  });

  it('intervalo_saida explícito preenche Saída int. ainda que longe do horário de almoço previsto', () => {
    const records = [
      tr({
        id: 'e1',
        user_id: 'u',
        created_at: `${day}T12:00:00.000Z`,
        timestamp: `${day}T08:00:00.000-03:00`,
        type: 'entrada',
        source: 'mobile',
      }),
      tr({
        id: 'i1',
        user_id: 'u',
        created_at: `${day}T15:00:00.000Z`,
        timestamp: `${day}T11:30:00.000-03:00`,
        type: 'intervalo_saida',
        source: 'mobile',
      }),
    ];
    const map = buildDayMirrorSummary(records, day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day);
    expect(dm?.entradaInicio).toBe('08:00');
    expect(dm?.saidaIntervalo).toBe('11:30');
  });
});

describe('buildDayMirrorSummary — produção APP + REP (hard lock cronológico)', () => {
  const day = '2026-05-11';
  const schedule = {
    entrada: '08:00',
    saida_intervalo: '12:00',
    volta_intervalo: '14:00',
    saida_final: '18:00',
    toleranceMin: 60,
  };

  it('APP 07:55 + REP 12:01 + REP 14:00: 1ª–3ª colunas preenchidas, Saída vazia, sem reuso de batida', () => {
    const records: TimeRecord[] = [
      tr({
        id: 'app-1',
        user_id: 'u',
        created_at: `${day}T10:55:00.000Z`,
        timestamp: `${day}T07:55:00.000-03:00`,
        type: 'entrada',
        source: 'mobile',
        origin: 'mobile',
      }),
      tr({
        id: 'rep-1',
        user_id: 'u',
        created_at: `${day}T15:01:00.000Z`,
        timestamp: `${day}T12:01:00.000-03:00`,
        type: 'saída',
        source: 'rep',
        method: 'rep',
        origin: 'rep',
      }),
      tr({
        id: 'rep-2',
        user_id: 'u',
        created_at: `${day}T17:00:00.000Z`,
        timestamp: `${day}T14:00:00.000-03:00`,
        type: 'saída',
        source: 'rep',
        method: 'rep',
        origin: 'rep',
      }),
    ];
    const map = buildDayMirrorSummary(records, day, day, { scheduleByDay: () => schedule });
    const dm = map.get(day)!;
    expect(dm.entradaInicio).toBe('07:55');
    expect(dm.saidaIntervalo).toBe('12:01');
    expect(dm.voltaIntervalo).toBe('14:00');
    expect(dm.saidaFinal).toBeNull();
    expect(dm.slotRecordIds).toEqual({
      entrada: 'app-1',
      saida_intervalo: 'rep-1',
      volta_intervalo: 'rep-2',
    });
    const assignedIds = dm.mirrorAudit?.filter((e) => e.kind === 'TIME RECORD SLOT ASSIGNED').map((e) => e.record_id);
    expect(new Set(assignedIds).size).toBe(3);
    expect(dm.batidasExtra).toHaveLength(0);
  });

  it('5ª batida vai para extras; record_id não aparece em dois slots', () => {
    const mkS = (id: string, hhmm: string) =>
      tr({
        id,
        user_id: 'u',
        created_at: `${day}T00:00:00.000Z`,
        timestamp: `${day}T${hhmm}:00.000-03:00`,
        type: 'saída',
        source: 'rep',
        method: 'rep',
      });
    const records = [mkS('a', '08:00'), mkS('b', '12:00'), mkS('c', '13:00'), mkS('d', '18:00'), mkS('e', '19:00')];
    const map = buildDayMirrorSummary(records, day, day);
    const dm = map.get(day)!;
    expect(dm.batidasExtra.map((r) => r.id)).toEqual(['e']);
    const slots = Object.values(dm.slotRecordIds ?? {});
    expect(new Set(slots).size).toBe(4);
  });

  it('reprocessamento estável: mesma entrada duas vezes buildDayMirrorSummary', () => {
    const records: TimeRecord[] = [
      tr({
        id: 'app-1',
        user_id: 'u',
        created_at: `${day}T10:55:00.000Z`,
        timestamp: `${day}T07:55:00.000-03:00`,
        type: 'entrada',
        source: 'mobile',
      }),
      tr({
        id: 'rep-1',
        user_id: 'u',
        created_at: `${day}T15:01:00.000Z`,
        timestamp: `${day}T12:01:00.000-03:00`,
        type: 'saída',
        source: 'rep',
        method: 'rep',
      }),
    ];
    const a = buildDayMirrorSummary(records, day, day, { scheduleByDay: () => schedule }).get(day)!;
    const b = buildDayMirrorSummary(records, day, day, { scheduleByDay: () => schedule }).get(day)!;
    expect(a).toEqual(b);
  });
});
