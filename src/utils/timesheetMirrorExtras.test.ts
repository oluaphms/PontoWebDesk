import { describe, expect, it } from 'vitest';
import {
  collectDayJustification,
  formatSignedOvertimeDisplay,
  parseTimesheetDailyOvertime,
} from './timesheetMirrorExtras';
import type { DayMirror } from './timesheetMirror';

describe('timesheetMirrorExtras', () => {
  it('formata hora extra positiva', () => {
    expect(formatSignedOvertimeDisplay(90, 0)).toBe('+01:30');
    expect(formatSignedOvertimeDisplay(135, 0)).toBe('+02:15');
  });

  it('formata hora extra negativa', () => {
    expect(formatSignedOvertimeDisplay(0, 45)).toBe('-00:45');
    expect(formatSignedOvertimeDisplay(30, 75)).toBe('-00:45');
  });

  it('retorna traço sem hora extra', () => {
    expect(formatSignedOvertimeDisplay(0, 0)).toBe('-');
  });

  it('agrega justificativas de batida e solicitação aprovada', () => {
    const day: Pick<DayMirror, 'date' | 'records'> = {
      date: '2026-06-10',
      records: [
        {
          id: '1',
          user_id: 'u',
          created_at: '2026-06-10T12:00:00Z',
          type: 'entrada',
          manual_reason: 'AT - Atestado médico',
        },
      ],
    };
    const text = collectDayJustification(day, [
      { adjustment_date: '2026-06-10', reason: 'Consulta médica autorizada' },
    ]);
    expect(text).toContain('Atestado médico');
    expect(text).toContain('Consulta médica autorizada');
  });

  it('retorna traço sem justificativa', () => {
    const day: Pick<DayMirror, 'date' | 'records'> = {
      date: '2026-06-10',
      records: [
        {
          id: '1',
          user_id: 'u',
          created_at: '2026-06-10T12:00:00Z',
          type: 'entrada',
          manual_reason: null,
        },
      ],
    };
    expect(collectDayJustification(day)).toBe('-');
  });

  it('lê overtime de timesheets_daily', () => {
    expect(
      parseTimesheetDailyOvertime({
        overtime_minutes: 60,
        raw_data: { negative_minutes: 15 },
      }),
    ).toEqual({ overtimeMinutes: 60, negativeMinutes: 15 });
  });
});
