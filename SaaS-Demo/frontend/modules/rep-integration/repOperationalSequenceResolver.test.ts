import { describe, expect, it } from 'vitest';
import {
  deriveOperationalDayUiStatus,
  reconcileOperationalDaySequence,
  repTipoMarcacaoToNorm,
  saoPauloCivilBoundsUtc,
} from './repOperationalSequenceResolver';

describe('saoPauloCivilBoundsUtc', () => {
  it('cobre o dia civil em offset −3', () => {
    const { startIso, endIso } = saoPauloCivilBoundsUtc('2026-05-06');
    expect(startIso).toBe('2026-05-06T03:00:00.000Z');
    expect(endIso.startsWith('2026-05-07')).toBe(true);
  });
});

describe('repTipoMarcacaoToNorm', () => {
  it('normaliza E/S/P', () => {
    expect(repTipoMarcacaoToNorm('E')).toBe('entrada');
    expect(repTipoMarcacaoToNorm('s')).toBe('saida');
    expect(repTipoMarcacaoToNorm('P')).toBe('pausa');
  });
});

describe('deriveOperationalDayUiStatus', () => {
  const day = '2026-05-06';
  const emp = '00000000-0000-0000-0000-000000000001';

  it('pending_rep quando só há fila REP sem issues', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [
        { id: 'a', data_hora: '2026-05-06T11:00:00.000Z', tipo_marcacao: 'E' },
      ],
    });
    expect(deriveOperationalDayUiStatus(r, 1, [])).toBe('pending_rep');
  });

  it('inconsistent quando sequência inválida (ex.: dupla entrada) mesmo com REP pendente', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [
        { id: 'a', data_hora: '2026-05-06T11:00:00.000Z', tipo_marcacao: 'E' },
        { id: 'b', data_hora: '2026-05-06T12:00:00.000Z', tipo_marcacao: 'E' },
      ],
    });
    expect(deriveOperationalDayUiStatus(r, 2, [])).toBe('inconsistent');
  });

  it('error quando extraErrors não vazio', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [],
    });
    expect(deriveOperationalDayUiStatus(r, 0, ['db'])).toBe('error');
  });
});

describe('reconcileOperationalDaySequence', () => {
  const day = '2026-05-06';
  const emp = '00000000-0000-0000-0000-000000000001';

  it('CENÁRIO 1: entrada e saída — promove ambos', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [
        { id: 'a', data_hora: '2026-05-06T11:00:00.000Z', tipo_marcacao: 'E' },
        { id: 'b', data_hora: '2026-05-06T21:00:00.000Z', tipo_marcacao: 'S' },
      ],
    });
    expect(r.resolutionByRepId.a).toBe('promote_normally');
    expect(r.resolutionByRepId.b).toBe('promote_normally');
    expect(r.issues.length).toBe(0);
  });

  it('CENÁRIO 2: dupla entrada — segunda pending', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [
        { id: 'a', data_hora: '2026-05-06T11:00:00.000Z', tipo_marcacao: 'E' },
        { id: 'b', data_hora: '2026-05-06T12:00:00.000Z', tipo_marcacao: 'E' },
      ],
    });
    expect(r.resolutionByRepId.a).toBe('promote_normally');
    expect(r.resolutionByRepId.b).toBe('keep_pending');
    expect(r.issues.some((i) => i.kind === 'duplicate_entry')).toBe(true);
  });

  it('CENÁRIO 3: entrada inválida no meio — restante classificável', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [
        { id: 'a', data_hora: '2026-05-06T11:00:00.000Z', tipo_marcacao: 'E' },
        { id: 'b', data_hora: '2026-05-06T12:00:00.000Z', tipo_marcacao: 'E' },
        { id: 'c', data_hora: '2026-05-06T15:00:00.000Z', tipo_marcacao: 'S' },
        { id: 'd', data_hora: '2026-05-06T16:00:00.000Z', tipo_marcacao: 'E' },
        { id: 'e', data_hora: '2026-05-06T21:00:00.000Z', tipo_marcacao: 'S' },
      ],
    });
    expect(r.resolutionByRepId.b).toBe('keep_pending');
    expect(r.resolutionByRepId.c).toBe('promote_normally');
    expect(r.resolutionByRepId.d).toBe('promote_normally');
    expect(r.resolutionByRepId.e).toBe('promote_normally');
  });

  it('CENÁRIO 4: fora de ordem na lista — ordena por instante', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [
        { id: 'late', data_hora: '2026-05-06T21:00:00.000Z', tipo_marcacao: 'S' },
        { id: 'first', data_hora: '2026-05-06T11:00:00.000Z', tipo_marcacao: 'E' },
      ],
    });
    expect(r.orderedEvents[0].id).toBe('first');
    expect(r.orderedEvents[1].id).toBe('late');
    expect(r.resolutionByRepId.first).toBe('promote_normally');
    expect(r.resolutionByRepId.late).toBe('promote_normally');
  });

  it('CENÁRIO 5: saída sem entrada — pending', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [],
      pendingRepPunches: [{ id: 'x', data_hora: '2026-05-06T15:00:00.000Z', tipo_marcacao: 'S' }],
    });
    expect(r.resolutionByRepId.x).toBe('keep_pending');
    expect(r.issues.some((i) => i.kind === 'orphan_exit')).toBe(true);
  });

  it('espelho com entrada + REP com saída e retorno — sem duplicata', () => {
    const r = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: [{ id: 'm1', timestamp: '2026-05-06T11:00:00.000Z', type: 'entrada' }],
      pendingRepPunches: [
        { id: 'p1', data_hora: '2026-05-06T15:00:00.000Z', tipo_marcacao: 'S' },
        { id: 'p2', data_hora: '2026-05-06T16:00:00.000Z', tipo_marcacao: 'E' },
        { id: 'p3', data_hora: '2026-05-06T21:00:00.000Z', tipo_marcacao: 'S' },
      ],
    });
    expect(r.issues.filter((i) => i.kind === 'duplicate_entry').length).toBe(0);
    expect(r.resolutionByRepId.p1).toBe('promote_normally');
    expect(r.resolutionByRepId.p2).toBe('promote_normally');
    expect(r.resolutionByRepId.p3).toBe('promote_normally');
  });
});
