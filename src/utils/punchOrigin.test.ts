import { describe, expect, it } from 'vitest';
import { isColaboradorSelfServicePunch, isRhAdjustmentOrigin, resolvePunchOrigin } from './punchOrigin';
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
      manual_reason: 'Teste no sistema',
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
      manual_reason: 'Teste no sistema',
    })).toBe(true);
  });

  it('classifica ajuste do RH com GPS como Ajuste Manual (editável no espelho)', () => {
    const payload = {
      source: 'manual',
      method: 'manual',
      origin: 'admin',
      manual_reason: 'Batida adicionada manualmente',
      is_manual: true,
      latitude: -23.55,
      longitude: -46.63,
    };
    expect(resolvePunchOrigin(payload).kind).toBe('admin');
    expect(resolvePunchOrigin(payload).label).toBe('Ajuste Manual');
    expect(isRhAdjustmentOrigin(payload)).toBe(true);
    expect(isColaboradorSelfServicePunch(payload)).toBe(false);
  });

  it('não classifica batida do app (gps) como RH mesmo com is_manual', () => {
    const payload = {
      source: 'manual',
      method: 'gps',
      origin: 'mobile',
      is_manual: true,
      latitude: -23.55,
      longitude: -46.63,
    };
    expect(resolvePunchOrigin(payload).kind).toBe('mobile');
    expect(isRhAdjustmentOrigin(payload)).toBe(false);
    expect(isColaboradorSelfServicePunch(payload)).toBe(true);
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

  it('não classifica app com origin=admin corrompido (source=manual, sem motivo) como RH', () => {
    const payload = {
      source: 'manual',
      method: 'manual',
      origin: 'admin',
      is_manual: true,
      latitude: -23.55,
      longitude: -46.63,
    };
    expect(resolvePunchOrigin(payload).kind).toBe('mobile');
    expect(isRhAdjustmentOrigin(payload)).toBe(false);
    expect(isColaboradorSelfServicePunch(payload)).toBe(true);
    expect(
      isManualRecord({
        id: '4',
        user_id: 'u',
        created_at: '2026-06-09T08:04:00Z',
        type: 'entrada',
        ...payload,
      }),
    ).toBe(false);
  });

  it('não classifica batida do app como RH quando origin=admin foi corrompido no backfill', () => {
    const payload = {
      source: 'web',
      method: 'manual',
      origin: 'admin',
      source_type: 'app',
      is_manual: true,
    };
    expect(resolvePunchOrigin(payload).kind).toBe('mobile');
    expect(resolvePunchOrigin(payload).label).toBe('Aplicativo');
    expect(isRhAdjustmentOrigin(payload)).toBe(false);
    expect(
      isManualRecord({
        id: '3',
        user_id: 'u',
        created_at: '2026-06-09T17:01:00Z',
        type: 'entrada',
        ...payload,
      }),
    ).toBe(false);
  });
});
