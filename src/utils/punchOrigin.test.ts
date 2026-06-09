import { describe, expect, it } from 'vitest';
import { isRhAdjustmentOrigin, resolvePunchOrigin } from './punchOrigin';
import { isManualRecord } from './timesheetMirror';

describe('resolvePunchOrigin', () => {
  it('classifica batida do colaborador (web + method manual + origin mobile) como Aplicativo', () => {
    const result = resolvePunchOrigin({
      source: 'web',
      method: 'manual',
      origin: 'mobile',
      source_type: 'app',
    });
    expect(result.kind).toBe('mobile');
    expect(result.label).toBe('Aplicativo');
    expect(isRhAdjustmentOrigin({ source: 'web', method: 'manual', origin: 'mobile' })).toBe(false);
    expect(
      isManualRecord({
        id: '1',
        user_id: 'u',
        created_at: '2026-06-09T12:00:00Z',
        type: 'entrada',
        source: 'web',
        method: 'manual',
        origin: 'mobile',
      }),
    ).toBe(false);
  });

  it('classifica ajuste do RH como Ajuste Manual', () => {
    const result = resolvePunchOrigin({
      source: 'manual',
      method: 'manual',
      origin: 'admin',
    });
    expect(result.kind).toBe('admin');
    expect(result.label).toBe('Ajuste Manual');
    expect(isManualRecord({
      id: '2',
      user_id: 'u',
      created_at: '2026-06-09T12:00:00Z',
      type: 'entrada',
      source: 'manual',
      method: 'manual',
      origin: 'admin',
    })).toBe(true);
  });

  it('classifica REP como Relógio REP', () => {
    expect(resolvePunchOrigin({ source: 'rep', method: 'rep', origin: 'rep' }).label).toBe('Relógio REP');
  });

  it('classifica importação AFD', () => {
    expect(resolvePunchOrigin({ source: 'AFD_IMPORT', method: 'rep', origin: 'rep' }).label).toBe('Importação AFD');
  });

  it('classifica portal web quando source=web sem origin mobile', () => {
    expect(resolvePunchOrigin({ source: 'web', method: 'api' }).label).toBe('Portal Web');
  });
});
