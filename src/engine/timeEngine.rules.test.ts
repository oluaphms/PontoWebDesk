import { describe, expect, it } from 'vitest';
import {
  applyNightRules,
  calculateDSR,
  calculateOvertime,
  classifyDay,
  isNationalHoliday,
  type CompanyRules,
} from './timeEngine';

const baseRules: CompanyRules = {
  work_on_saturday: false,
  saturday_overtime_type: '100',
  time_bank_enabled: false,
  tolerance_minutes: 10,
  night_additional_percent: 20,
  dsr_enabled: true,
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

  it('sábado trabalhado vs não trabalhado respeita regra da empresa', () => {
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
    expect(saturdayNotWorkday.overtime_100_minutes).toBe(60);
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
    ]);
    expect(withAbsence).toBe(0);
    expect(withoutAbsence).toBe(45);
  });
});
