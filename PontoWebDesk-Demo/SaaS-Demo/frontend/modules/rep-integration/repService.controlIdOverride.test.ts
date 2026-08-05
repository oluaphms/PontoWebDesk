import { describe, expect, it, vi } from 'vitest';
import { ingestPunch } from './repService';
import { installOperationalTestIsolation } from '../../src/testing/operationalTestIsolation';

describe('ingestPunch — não anula PIS válido já vindo do fetch (AFD truncado no raw)', () => {
  installOperationalTestIsolation();

  it('mantém pis/cpf quando DV válido mesmo que parse da linha AFD dê outro valor', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { success: true, user_not_found: false, time_record_id: 'tr1' },
      error: null,
    });
    const supabase = { rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const afdTruncado = '00001649430405202610570000067427657051';
    await ingestPunch(supabase, {
      company_id: '00000000-0000-0000-0000-000000000001',
      rep_device_id: null,
      pis: '12966742765',
      cpf: '12966742765',
      matricula: '6',
      nome_funcionario: null,
      data_hora: '2026-05-04T13:57:00.000Z',
      tipo_marcacao: 'E',
      nsr: 16494,
      raw_data: {
        source: 'controlid_afd',
        raw: afdTruncado,
        nsr: 16494,
        cpfOuPis: '12966742765',
      },
      force_user_id: 'user-1',
    });

    const payload = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.p_pis).toBe('12966742765');
    expect(payload.p_cpf).toBe('12966742765');
    expect(payload.p_matricula).toBe('6');
  });

  it('usa parse da linha quando o pis recebido é inválido e o parse devolve PIS válido', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { success: true, user_not_found: false, time_record_id: 'tr1' },
      error: null,
    });
    const supabase = { rpc } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const linha12 = '000016494304052026105700012966742765';
    await ingestPunch(supabase, {
      company_id: '00000000-0000-0000-0000-000000000001',
      rep_device_id: null,
      pis: '67427657051',
      cpf: '67427657051',
      matricula: null,
      nome_funcionario: null,
      data_hora: '2026-05-04T13:57:00.000Z',
      tipo_marcacao: 'E',
      nsr: 16494,
      raw_data: { source: 'controlid_afd', raw: linha12 },
      force_user_id: 'user-1',
    });

    const payload = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.p_pis).toBe('12966742765');
    expect(payload.p_cpf).toBe('12966742765');
  });
});
