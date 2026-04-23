import { describe, it, expect } from 'vitest';
import { getDayStatus, type DayMirror } from './timesheetMirror';

function baseDay(partial: Partial<DayMirror>): DayMirror {
  return {
    date: '2026-04-18',
    entradaInicio: null,
    saidaIntervalo: null,
    voltaIntervalo: null,
    saidaFinal: null,
    workedMinutes: 0,
    records: [],
    ...partial,
  };
}

describe('getDayStatus — escala com sábado útil (6x1)', () => {
  it('sábado 18/04/2026 08:00–12:00 dentro da janela → NORMAL (quatro batidas)', () => {
    const day = baseDay({
      date: '2026-04-18',
      entradaInicio: '08:00',
      saidaIntervalo: '10:00',
      voltaIntervalo: '10:15',
      saidaFinal: '12:00',
      workedMinutes: 225,
      records: [{ id: '1', user_id: 'u', created_at: '2026-04-18T08:00:00', type: 'entrada' } as any],
    });
    const st = getDayStatus(day, [1, 2, 3, 4, 5, 6], {
      entrada: '08:00',
      saida: '12:00',
      toleranceMin: 0,
    });
    expect(st.status).toBe('normal');
    expect(st.label).toBe('NORMAL');
  });

  it('sábado com batidas mas fora de workDays (legado seg–sex) → EXTRA', () => {
    const day = baseDay({
      date: '2026-04-18',
      entradaInicio: '08:00',
      saidaIntervalo: '10:00',
      voltaIntervalo: '10:15',
      saidaFinal: '12:00',
      workedMinutes: 225,
      records: [{ id: '1', user_id: 'u', created_at: '2026-04-18T08:00:00', type: 'entrada' } as any],
    });
    const st = getDayStatus(day, [1, 2, 3, 4, 5]);
    expect(st.status).toBe('extra');
    expect(st.label).toBe('EXTRA');
  });

  it('sábado útil com entrada antes da tolerância → EXTRA (quatro batidas)', () => {
    const day = baseDay({
      date: '2026-04-18',
      entradaInicio: '06:30',
      saidaIntervalo: '10:00',
      voltaIntervalo: '10:15',
      saidaFinal: '12:00',
      workedMinutes: 315,
      records: [{ id: '1', user_id: 'u', created_at: '2026-04-18T06:30:00', type: 'entrada' } as any],
    });
    const st = getDayStatus(day, [1, 2, 3, 4, 5, 6], { entrada: '08:00', saida: '12:00', toleranceMin: 10 });
    expect(st.status).toBe('extra');
  });

  it('dia útil com só entrada e saída (sem intervalo) → INCOMPLETO', () => {
    const day = baseDay({
      date: '2026-04-21',
      entradaInicio: '08:00',
      saidaIntervalo: null,
      voltaIntervalo: null,
      saidaFinal: '17:00',
      workedMinutes: 540,
      records: [{ id: '1', user_id: 'u', created_at: '2026-04-21T08:00:00', type: 'entrada' } as any],
    });
    const st = getDayStatus(day, [1, 2, 3, 4, 5], { entrada: '08:00', saida: '17:00', toleranceMin: 0 });
    expect(st.status).toBe('incomplete');
    expect(st.label).toBe('INCOMPLETO');
  });

  it('feriado não pode ser falta no espelho', () => {
    const day = baseDay({
      date: '2026-04-21',
      records: [],
    });
    const holidays = new Set<string>(['2026-04-21']);
    const st = getDayStatus(day, [1, 2, 3, 4, 5], { entrada: '08:00', saida: '17:00', toleranceMin: 0 }, holidays);
    expect(st.status).toBe('holiday');
    expect(st.label).toBe('FERIADO');
  });
});
