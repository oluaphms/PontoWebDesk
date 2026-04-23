import { describe, it, expect } from 'vitest';
import {
  buildDayMirrorSummary,
  calendarDateForEspelhoRow,
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

describe('buildDayMirrorSummary — prioridade relógio (rep)', () => {
  it('coluna Entrada usa a batida do relógio, não uma entrada mobile mais cedo no mesmo dia', () => {
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
    expect(map.get(day)?.entradaInicio).toBe('08:03');
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
    expect(dm?.saidaFinal).toBe('12:09');
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
