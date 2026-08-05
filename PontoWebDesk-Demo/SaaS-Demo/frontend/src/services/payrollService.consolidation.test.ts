import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('../../services/supabaseClient', () => ({
  checkSupabaseConfigured: () => true,
  isSupabaseConfigured: () => true,
  db: {
    select: (...args: unknown[]) => selectMock(...args),
    insert: (...args: unknown[]) => insertMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

import { consolidarFolhaPeriodo } from './payrollService';

const COMPANY_ID = '22222222-2222-2222-2222-222222222222';
const PERIODO_ID = '33333333-3333-3333-3333-333333333333';
const EMP_ID = '44444444-4444-4444-4444-444444444444';
const EVENTO_PROV = '55555555-5555-5555-5555-555555555555';
const EVENTO_DESC = '66666666-6666-6666-6666-666666666666';

describe('consolidarFolhaPeriodo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockImplementation(async (table: string, row: Record<string, unknown>) => {
      if (table === 'folha_pagamento_itens') return row;
      return { id: PERIODO_ID, ...row };
    });
    updateMock.mockResolvedValue(undefined);
    deleteMock.mockResolvedValue(undefined);
  });

  function mockDbClosedPeriod() {
    selectMock.mockImplementation(async (table: string) => {
      if (table === 'folha_pagamento_periodos') {
        return [{ id: PERIODO_ID, status: 'fechada', company_id: COMPANY_ID, ano: 2026, mes: 5 }];
      }
      return [];
    });
  }

  function mockDbOpenPeriodWithEmployee() {
    selectMock.mockImplementation(async (table: string) => {
      if (table === 'folha_pagamento_periodos') {
        return [{ id: PERIODO_ID, status: 'rascunho', company_id: COMPANY_ID, ano: 2026, mes: 5 }];
      }
      if (table === 'users') {
        return [
          {
            id: EMP_ID,
            company_id: COMPANY_ID,
            role: 'employee',
            status: 'active',
            salario_base: 3000,
          },
        ];
      }
      if (table === 'eventos_folha') {
        return [
          { id: EVENTO_PROV, codigo: 'HE50', natureza: 'provento', company_id: COMPANY_ID },
          { id: EVENTO_DESC, codigo: 'VT', natureza: 'desconto', company_id: COMPANY_ID },
        ];
      }
      if (table === 'lancamento_eventos') {
        return [
          {
            user_id: EMP_ID,
            company_id: COMPANY_ID,
            evento_id: EVENTO_PROV,
            valor_total: 500,
            data: '2026-05-10',
          },
          {
            user_id: EMP_ID,
            company_id: COMPANY_ID,
            evento_id: EVENTO_DESC,
            valor_total: 200,
            data: '2026-05-12',
          },
          {
            user_id: EMP_ID,
            company_id: COMPANY_ID,
            evento_id: EVENTO_PROV,
            valor_total: 100,
            data: '2026-04-01',
          },
        ];
      }
      if (table === 'folha_pagamento_itens') return [];
      return [];
    });
  }

  it('rejeita consolidar período fechado', async () => {
    mockDbClosedPeriod();
    await expect(consolidarFolhaPeriodo(COMPANY_ID, 2026, 5)).rejects.toThrow(/Período fechado/);
  });

  it('calcula líquido = salário + proventos − descontos (somente lançamentos do mês)', async () => {
    mockDbOpenPeriodWithEmployee();
    const result = await consolidarFolhaPeriodo(COMPANY_ID, 2026, 5);

    expect(result.funcionarios).toBe(1);
    expect(insertMock).toHaveBeenCalledWith(
      'folha_pagamento_itens',
      expect.objectContaining({
        user_id: EMP_ID,
        salario_base: 3000,
        total_proventos: 500,
        total_descontos: 200,
        liquido: 3300,
      }),
    );
  });
});
