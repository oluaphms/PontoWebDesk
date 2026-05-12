import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));
const supabaseClient = { from: fromMock };

vi.mock('./supabaseClient', () => ({
  getSupabaseClient: () => supabaseClient,
}));

vi.mock('./deviceOperationalReputation.service', () => ({
  getOperationalDeviceKey: () => 'device-1',
}));

vi.mock('../domain/operational/bus/operationalEventBus', () => ({
  operationalBusEmit: vi.fn(),
}));

import {
  insertOperationalLegalAuditTrail,
  __resetOperationalLegalAuditCircuitForTests,
} from './operationalLegalAuditTrail.service';

const baseInput = {
  companyId: 'co-1',
  actorId: 'user-1',
  action: 'force_monitoring_refresh',
};

describe('insertOperationalLegalAuditTrail — circuit breaker', () => {
  beforeEach(() => {
    __resetOperationalLegalAuditCircuitForTests();
    insertMock.mockReset();
    fromMock.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emite o insert normalmente em sucesso e mantém o breaker fechado', async () => {
    insertMock.mockResolvedValueOnce({ error: null });
    const r = await insertOperationalLegalAuditTrail(baseInput);
    expect(r.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('abre o breaker na primeira falha de RLS e suspende inserts subsequentes', async () => {
    insertMock.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });
    const r1 = await insertOperationalLegalAuditTrail(baseInput);
    expect(r1.ok).toBe(false);
    expect(insertMock).toHaveBeenCalledTimes(1);

    const suppressed = await insertOperationalLegalAuditTrail(baseInput);
    expect(suppressed.ok).toBe(false);
    expect(suppressed.skipped).toBe('circuit_open');
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('não conta erros não relacionados a permissão como falhas do breaker', async () => {
    insertMock.mockResolvedValue({ error: { message: 'connection reset' } });
    for (let i = 0; i < 5; i += 1) {
      await insertOperationalLegalAuditTrail(baseInput);
    }
    insertMock.mockResolvedValueOnce({ error: null });
    const r = await insertOperationalLegalAuditTrail(baseInput);
    expect(r.ok).toBe(true);
  });

  it('reseta o breaker após reset manual e volta a inserir', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'new row violates row-level security policy' } });
    await insertOperationalLegalAuditTrail(baseInput);
    expect(insertMock).toHaveBeenCalledTimes(1);

    let suppressed = await insertOperationalLegalAuditTrail(baseInput);
    expect(suppressed.skipped).toBe('circuit_open');

    __resetOperationalLegalAuditCircuitForTests();
    insertMock.mockResolvedValueOnce({ error: null });
    const ok = await insertOperationalLegalAuditTrail(baseInput);
    expect(ok.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(2);

    insertMock.mockResolvedValueOnce({ error: { message: 'new row violates row-level security policy' } });
    const next = await insertOperationalLegalAuditTrail(baseInput);
    expect(next.ok).toBe(false);
    expect(next.skipped).toBeUndefined();
  });
});
