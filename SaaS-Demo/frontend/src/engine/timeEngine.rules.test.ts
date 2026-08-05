import { describe, expect, it } from 'vitest';
import type { RawTimeRecord } from '../services/timeProcessingService';
import {
  applyNightRules,
  assertDailyMathematicalConsistency,
  calculateDSRExtraImpactMinutes,
  calculateDSR,
  calculateOvertime,
  classifyDay,
  isNationalHoliday,
  splitNightMinutesNormalVsExtraForDate,
  splitOvertimeForProduction,
  type CompanyRules,
} from './timeEngine';

const baseRules: CompanyRules = {
  work_on_saturday: false,
  saturday_overtime_type: '100',
  time_bank_enabled: false,
  tolerance_minutes: 10,
  night_additional_percent: 20,
  dsr_enabled: true,
  allow_auto_compensation: true,
  weekday_extra_above_120: '50',
  bank_hours_expiry_months: 6,
  extra_payroll_policy: 'bank',
  mixed_extra_bank_cap_minutes: 120,
};

describe('timeEngine consolidated rules', () => {
  it('dia útil com extra vai para 50%', () => {
    const out = calculateOvertime({
      date: '2026-04-21',
      dayType: 'WEEKDAY',
      workedMinutes: 600,
      expectedMinutes: 480,
      companyRules: baseRules,
      schedule: null,
    });
    expect(out.overtime_50_minutes).toBe(120);
    expect(out.overtime_100_minutes).toBe(0);
  });

  it('sábado sempre classifica extra como 50%', () => {
    const saturdayNotWorkday = calculateOvertime({
      date: '2026-04-18',
      dayType: 'SATURDAY',
      workedMinutes: 300,
      expectedMinutes: 240,
      companyRules: { ...baseRules, work_on_saturday: false, saturday_overtime_type: '100' },
      schedule: null,
    });
    const saturdayWorkday = calculateOvertime({
      date: '2026-04-18',
      dayType: 'SATURDAY',
      workedMinutes: 300,
      expectedMinutes: 240,
      companyRules: { ...baseRules, work_on_saturday: true, saturday_overtime_type: '100' },
      schedule: null,
    });
    expect(saturdayNotWorkday.overtime_50_minutes).toBe(60);
    expect(saturdayWorkday.overtime_50_minutes).toBe(60);
  });

  it('domingo e feriado sempre 100%', () => {
    const sunday = calculateOvertime({
      date: '2026-04-19',
      dayType: 'SUNDAY',
      workedMinutes: 240,
      expectedMinutes: 0,
      companyRules: baseRules,
      schedule: null,
    });
    const holiday = calculateOvertime({
      date: '2026-12-25',
      dayType: 'HOLIDAY',
      workedMinutes: 240,
      expectedMinutes: 0,
      companyRules: baseRules,
      schedule: null,
    });
    expect(sunday.overtime_100_minutes).toBe(240);
    expect(holiday.overtime_100_minutes).toBe(240);
  });

  it('feriados nacionais fixos incluem 21/04', () => {
    expect(isNationalHoliday('2026-04-21')).toBe(true);
  });

  it('21/04 é classificado como HOLIDAY automaticamente', async () => {
    const dayType = await classifyDay({
      date: '2026-04-21',
      company: { id: '' },
    });
    expect(dayType).toBe('HOLIDAY');
  });

  it('adicional noturno aplica hora reduzida + adicional percentual', () => {
    const night = applyNightRules(60, { ...baseRules, night_additional_percent: 20 });
    expect(night.reducedNightMinutes).toBe(69);
    expect(night.additionalMinutes).toBe(14);
    expect(night.payableNightMinutes).toBe(83);
  });

  it('DSR é zerado com falta injustificada', () => {
    const withAbsence = calculateDSR([
      { date: '2026-04-20', hasUnjustifiedAbsence: false, overtimeMinutes: 60 },
      { date: '2026-04-21', hasUnjustifiedAbsence: true, overtimeMinutes: 30 },
    ]);
    const withoutAbsence = calculateDSR([
      { date: '2026-04-20', hasUnjustifiedAbsence: false, overtimeMinutes: 60 },
      { date: '2026-04-21', hasUnjustifiedAbsence: false, overtimeMinutes: 30 },
      { date: '2026-04-22', hasUnjustifiedAbsence: false, overtimeMinutes: 0 },
      { date: '2026-04-23', hasUnjustifiedAbsence: false, overtimeMinutes: 0 },
      { date: '2026-04-24', hasUnjustifiedAbsence: false, overtimeMinutes: 0 },
      { date: '2026-04-25', hasUnjustifiedAbsence: false, overtimeMinutes: 0 },
      { date: '2026-04-26', hasUnjustifiedAbsence: false, overtimeMinutes: 0 },
    ]);
    expect(withAbsence).toBe(0);
    /** 90 min em 5 dias úteis (seg–sex) × 1 domingo no recorte sintético ≈ 18 min. */
    expect(withoutAbsence).toBe(18);
  });

  it('DSR exemplo blueprint: 600 min / 5 dias × 1 domingo = 120 min', () => {
    expect(
      calculateDSRExtraImpactMinutes({
        totalExtraMinutes: 600,
        mondayFridayUtilityDaysCount: 5,
        restDaysCount: 1,
      }),
    ).toBe(120);
  });

  it('equação matemática diária válida antes de gravar', () => {
    expect(() =>
      assertDailyMathematicalConsistency({
        worked: 420,
        expected: 480,
        extra: 0,
        negative: 60,
        falta: 0,
        dateStr: '2026-05-05',
      }),
    ).not.toThrow();
    expect(() =>
      assertDailyMathematicalConsistency({
        worked: 500,
        expected: 480,
        extra: 20,
        negative: 0,
        falta: 0,
        dateStr: '2026-05-05',
      }),
    ).not.toThrow();
  });

  it('HE útil: 2h primeira faixa em 50% e excesso segundo percentual configurado', () => {
    const exTotal = 180;
    const a = splitOvertimeForProduction(
      'WEEKDAY',
      480 + exTotal,
      480,
      exTotal,
      { saturday_overtime_type: '100', weekday_extra_above_120: '100' },
    );
    expect(a.extra50).toBe(120);
    expect(a.extra100).toBe(60);
    const b = splitOvertimeForProduction(
      'WEEKDAY',
      480 + exTotal,
      480,
      exTotal,
      { saturday_overtime_type: '100', weekday_extra_above_120: '50' },
    );
    expect(b.extra50).toBe(180);
    expect(b.extra100).toBe(0);
  });

  it('domingo com jornada 0 → toda marcação como extra 100%', () => {
    const s = splitOvertimeForProduction('SUNDAY', 300, 0, 300, {
      saturday_overtime_type: '50',
      weekday_extra_above_120: '50',
    });
    expect(s.extra100).toBe(300);
    expect(s.extra50).toBe(0);
  });

  it('noturno proporcional: 60 min noturnas, 60 min trabalhadas, teto 40 → 40/20', () => {
    const day = '2026-05-04';
    const records: RawTimeRecord[] = [
      { id: '1', created_at: `${day}T22:30:00`, timestamp: `${day}T22:30:00`, type: 'entrada' },
      { id: '2', created_at: `${day}T23:30:00`, timestamp: `${day}T23:30:00`, type: 'saida' },
    ];
    const split = splitNightMinutesNormalVsExtraForDate(records, day, 40);
    expect(split.nightNormal + split.nightExtra).toBe(60);
    expect(split.nightNormal).toBe(40);
    expect(split.nightExtra).toBe(20);
  });
});
