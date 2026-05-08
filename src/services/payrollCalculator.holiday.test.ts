import { describe, expect, it, vi } from 'vitest';
import { installOperationalTestIsolation } from '../testing/operationalTestIsolation';

vi.mock('./timeProcessingService', () => ({
  processDailyTime: vi.fn(async () => ({
    total_worked_minutes: 0,
    expected_minutes: 480,
    overtime_minutes: 0,
    late_minutes: 0,
    entrada: null,
    saida: null,
    inicio_intervalo: null,
    fim_intervalo: null,
    scheduled_day_off: false,
  })),
  getDayRecords: vi.fn(async () => []),
  resolveEmployeeScheduleForDate: vi.fn(async () => ({
    schedule: {
      start_time: '08:00',
      end_time: '17:00',
      break_start: '12:00',
      break_end: '13:00',
      tolerance_minutes: 10,
      daily_hours: 8,
      work_days: [1, 2, 3, 4, 5],
    },
    jsDayOfWeek: 1,
  })),
  fetchUserScheduleId: vi.fn(async () => 'schedule-1'),
  summarizeDayRecords: vi.fn(() => ({
    totalMinutes: 0,
    entrada: null,
    saida: null,
    inicio_intervalo: null,
    fim_intervalo: null,
    break_minutes: 0,
  })),
}));

vi.mock('../engine/timeEngine', async () => {
  const actual = await vi.importActual<typeof import('../engine/timeEngine')>('../engine/timeEngine');
  return {
    ...actual,
    getCompanyRules: vi.fn(async () => ({
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
    })),
  };
});

import { processDailyTime } from './timeProcessingService';
import { calculateDailyTimesheet } from './payrollCalculator';

describe('calculateDailyTimesheet holiday behavior', () => {
  installOperationalTestIsolation();

  it('2026-04-21 sem trabalho: HOLIDAY sem falta, esperado zero e extra100 zero', async () => {
    const mockedProcess = vi.mocked(processDailyTime);
    mockedProcess.mockResolvedValueOnce({
      total_worked_minutes: 0,
      expected_minutes: 480,
      overtime_minutes: 0,
      late_minutes: 0,
      entrada: null,
      saida: null,
      inicio_intervalo: null,
      fim_intervalo: null,
      scheduled_day_off: false,
    });
    const out = await calculateDailyTimesheet('emp-1', 'company-1', '2026-04-21');
    expect(out.raw_data?.day_type).toBe('HOLIDAY');
    expect(out.is_absence).toBe(false);
    expect(out.expected_minutes).toBe(0);
    expect(out.raw_data?.overtime_100_minutes).toBe(0);
  });

  it('2026-04-21 com trabalho: extra 100% pelo total trabalhado', async () => {
    const mockedProcess = vi.mocked(processDailyTime);
    mockedProcess.mockResolvedValueOnce({
      total_worked_minutes: 480,
      expected_minutes: 480,
      overtime_minutes: 0,
      late_minutes: 0,
      entrada: '08:00',
      saida: '17:00',
      inicio_intervalo: '12:00',
      fim_intervalo: '13:00',
      scheduled_day_off: false,
    });
    const out = await calculateDailyTimesheet('emp-1', 'company-1', '2026-04-21');
    expect(out.raw_data?.day_type).toBe('HOLIDAY');
    expect(out.raw_data?.overtime_100_minutes).toBe(480);
  });
});
