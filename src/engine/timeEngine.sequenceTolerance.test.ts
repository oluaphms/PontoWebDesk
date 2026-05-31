import { describe, expect, it, vi } from 'vitest';
import {
  SEQUENCE_TOLERANCE_MIN_GAP_MS,
  applyEntradaDuplicationTolerance,
  parseTimeRecords,
} from './timeEngine';
import type { RawTimeRecord } from '../services/timeProcessingService';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

describe('sequência tolerante (entrada duplicada → saída)', () => {
  it('converte segunda entrada em saída quando intervalo > 5 minutos', () => {
    const warn = vi.spyOn(observabilityConsole, 'warn').mockImplementation(() => {});
    const base = '2026-05-05T';
    const r: RawTimeRecord[] = [
      {
        id: 'a',
        created_at: `${base}08:00:00.000Z`,
        timestamp: `${base}08:00:00.000Z`,
        type: 'entrada',
      },
      {
        id: 'b',
        created_at: `${base}08:10:00.000Z`,
        timestamp: `${base}08:10:00.000Z`,
        type: 'entrada',
      },
    ];
    const { records, hadAdjustment } = applyEntradaDuplicationTolerance(r);
    expect(hadAdjustment).toBe(true);
    expect(records[1].type).toBe('saida');
    expect(records[1].raw_data?.sequence_adjusted).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('não converte se intervalo ≤ 5 minutos', () => {
    const base = '2026-05-05T';
    const r: RawTimeRecord[] = [
      {
        id: 'a',
        created_at: `${base}08:00:00.000Z`,
        timestamp: `${base}08:00:00.000Z`,
        type: 'entrada',
      },
      {
        id: 'b',
        created_at: `${base}08:03:00.000Z`,
        timestamp: `${base}08:03:00.000Z`,
        type: 'entrada',
      },
    ];
    const { records, hadAdjustment } = applyEntradaDuplicationTolerance(r);
    expect(hadAdjustment).toBe(false);
    expect(records[1].type).toBe('entrada');
  });

  it('parseTimeRecords usa tolerância antes dos segmentos', () => {
    vi.spyOn(observabilityConsole, 'warn').mockImplementation(() => {});
    const base = '2026-05-05T';
    const r: RawTimeRecord[] = [
      {
        id: 'a',
        created_at: `${base}08:00:00.000Z`,
        timestamp: `${base}08:00:00.000Z`,
        type: 'entrada',
      },
      {
        id: 'b',
        created_at: `${base}09:00:00.000Z`,
        timestamp: `${base}09:00:00.000Z`,
        type: 'entrada',
      },
    ];
    const parsed = parseTimeRecords(r);
    const kinds = parsed.segments.map((s) => s.type);
    expect(kinds).toContain('saida');
    expect(SEQUENCE_TOLERANCE_MIN_GAP_MS).toBe(5 * 60 * 1000);
  });
});
