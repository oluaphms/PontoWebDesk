import { describe, it, expect } from 'vitest';
import { shiftRecordToWorkScheduleInfo } from './timeProcessingService';

describe('shiftRecordToWorkScheduleInfo — sábado curto sem intervalo', () => {
  it('08:00–12:00 sem break explícito → jornada líquida 4h (240 min) via expected span', () => {
    const s = shiftRecordToWorkScheduleInfo({
      start_time: '08:00:00',
      end_time: '12:00:00',
      break_minutes: 60,
      tolerance_minutes: 10,
      daily_hours: 4,
    });
    const start = 8 * 60;
    const end = 12 * 60;
    const brk =
      s.break_end > s.break_start
        ? (() => {
            const [bh, bm] = s.break_start.split(':').map(Number);
            const [eh, em] = s.break_end.split(':').map(Number);
            return eh * 60 + em - (bh * 60 + bm);
          })()
        : 0;
    const span = end - start - brk;
    expect(span).toBe(240);
  });
});
