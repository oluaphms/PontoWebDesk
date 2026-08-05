import { describe, expect, it } from 'vitest';
import {
  auditDayPunchSequence,
  auditNextPunchRegistration,
  PUNCH_SEQUENCE_INCONSISTENCY_CODES,
  punchSequenceIssueLabel,
} from './punchSequenceAudit';
import type { RawTimeRecord } from '../../services/timeProcessingService';
import { validatePunchSequence } from '../../services/timeProcessingService';

function tr(partial: Partial<RawTimeRecord> & Pick<RawTimeRecord, 'id' | 'type'>): RawTimeRecord {
  return {
    timestamp: partial.timestamp ?? '2026-06-17T08:00:00.000-03:00',
    created_at: partial.created_at ?? partial.timestamp ?? '2026-06-17T08:00:00.000-03:00',
    ...partial,
  };
}

describe('punchSequenceAudit — flexibilização de sequência', () => {
  it('Cenário 1: intervalo sem entrada — registra com aviso', () => {
    const audit = auditNextPunchRegistration([], 'pausa');
    expect(audit.warnings.map((w) => w.code)).toContain('INTERVAL_WITHOUT_ENTRY');
    const validation = validatePunchSequence([], 'pausa');
    expect(validation.valid).toBe(true);
    expect(validation.warnings?.length).toBeGreaterThan(0);
  });

  it('Cenário 2: retorno sem intervalo inicial', () => {
    const audit = auditNextPunchRegistration([], 'entrada');
    expect(audit.warnings).toHaveLength(0);
    const day = auditDayPunchSequence([
      tr({ id: '1', type: 'entrada', timestamp: '2026-06-17T14:00:00.000-03:00' }),
    ]);
    expect(day.some((w) => w.code === 'INCOMPLETE_JOURNEY')).toBe(true);
  });

  it('Cenário 3: saída sem entrada', () => {
    const audit = auditNextPunchRegistration([], 'saida');
    expect(audit.warnings[0]?.code).toBe('EXIT_WITHOUT_ENTRY');
    expect(validatePunchSequence([], 'saida').valid).toBe(true);
  });

  it('Cenário 4: intervalo + retorno + saída sem entrada', () => {
    const records = [
      tr({ id: '1', type: 'pausa', timestamp: '2026-06-17T12:00:00.000-03:00' }),
      tr({ id: '2', type: 'entrada', timestamp: '2026-06-17T14:00:00.000-03:00' }),
      tr({ id: '3', type: 'saida', timestamp: '2026-06-17T18:00:00.000-03:00' }),
    ];
    const day = auditDayPunchSequence(records);
    expect(day.some((w) => w.code === 'MISSING_ENTRY')).toBe(true);
  });

  it('Cenário 5: primeira batida = saída', () => {
    const audit = auditNextPunchRegistration([], 'saida');
    expect(audit.warnings[0]?.code).toBe('EXIT_WITHOUT_ENTRY');
    expect(punchSequenceIssueLabel('EXIT_WITHOUT_ENTRY')).toContain('Saída');
  });

  it('jornada com apenas uma batida incompleta', () => {
    const day = auditDayPunchSequence([
      tr({ id: '1', type: 'pausa', timestamp: '2026-06-17T12:00:00.000-03:00' }),
    ]);
    expect(day.map((w) => w.code)).toEqual(
      expect.arrayContaining(['MISSING_ENTRY', 'INCOMPLETE_JOURNEY']),
    );
  });

  it('saída sem retorno de intervalo', () => {
    const records = [
      tr({ id: '1', type: 'entrada', timestamp: '2026-06-17T08:00:00.000-03:00' }),
      tr({ id: '2', type: 'pausa', timestamp: '2026-06-17T12:00:00.000-03:00' }),
    ];
    const next = auditNextPunchRegistration(records, 'saida');
    expect(next.warnings[0]?.code).toBe('EXIT_WITHOUT_INTERVAL_RETURN');
    expect(validatePunchSequence(records, 'saida').valid).toBe(true);
  });

  it('jornada corrigida posteriormente remove pendência de entrada', () => {
    const partial = [
      tr({ id: '1', type: 'pausa', timestamp: '2026-06-17T12:00:00.000-03:00' }),
      tr({ id: '2', type: 'entrada', timestamp: '2026-06-17T14:00:00.000-03:00' }),
    ];
    expect(auditDayPunchSequence(partial).some((w) => w.code === 'MISSING_ENTRY')).toBe(true);
    const fixed = [
      tr({ id: '0', type: 'entrada', timestamp: '2026-06-17T08:00:00.000-03:00' }),
      ...partial,
      tr({ id: '3', type: 'saida', timestamp: '2026-06-17T18:00:00.000-03:00' }),
    ];
    expect(auditDayPunchSequence(fixed).some((w) => w.code === 'MISSING_ENTRY')).toBe(false);
  });

  it('códigos canônicos exportados', () => {
    expect(PUNCH_SEQUENCE_INCONSISTENCY_CODES.MISSING_ENTRY).toBe('MISSING_ENTRY');
  });
});
