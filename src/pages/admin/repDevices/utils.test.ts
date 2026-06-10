import { describe, expect, it } from 'vitest';
import { isEmployeeEligibleForRepPush } from './utils';

describe('isEmployeeEligibleForRepPush', () => {
  it('aceita colaborador ativo', () => {
    expect(isEmployeeEligibleForRepPush({ id: '1', nome: 'A', status: 'active' })).toBe(true);
  });

  it('rejeita colaborador inativo', () => {
    expect(isEmployeeEligibleForRepPush({ id: '1', nome: 'A', status: 'inactive' })).toBe(false);
  });

  it('rejeita colaborador invisível ou demitido', () => {
    expect(isEmployeeEligibleForRepPush({ id: '1', nome: 'A', status: 'active', invisivel: true })).toBe(false);
    expect(
      isEmployeeEligibleForRepPush({ id: '1', nome: 'A', status: 'active', demissao: '2026-01-01' }),
    ).toBe(false);
  });
});
