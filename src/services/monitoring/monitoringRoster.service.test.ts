import { describe, expect, it } from 'vitest';
import { buildMonitoringRoster, isActiveMonitoringEmployee } from './monitoringRoster.service';

describe('monitoringRoster', () => {
  it('usa apenas colaboradores ativos visíveis', () => {
    const { roster } = buildMonitoringRoster(
      [
        { id: 'e1', nome: 'Ana', email: 'ana@x.com', role: 'employee', status: 'active', company_id: 'c1' },
        { id: 'e2', nome: 'Bruno', email: 'bruno@x.com', role: 'employee', status: 'inactive', company_id: 'c1' },
        { id: 'e3', nome: 'Oculto', email: 'o@x.com', role: 'employee', status: 'active', company_id: 'c1', invisivel: true },
      ],
      [
        { id: 'u-admin', email: 'admin@x.com' },
        { id: 'u-ana', email: 'ana@x.com' },
      ],
    );
    expect(roster).toHaveLength(1);
    expect(roster[0]?.id).toBe('e1');
  });

  it('liga user_id alternativo por e-mail', () => {
    const { aliases } = buildMonitoringRoster(
      [{ id: 'e1', nome: 'Ana', email: 'ana@x.com', role: 'employee', status: 'active', company_id: 'c1' }],
      [{ id: 'u-ana', email: 'ana@x.com' }],
    );
    expect(aliases.get('e1')).toEqual(expect.arrayContaining(['e1', 'u-ana']));
  });

  it('isActiveMonitoringEmployee rejeita demitidos', () => {
    expect(
      isActiveMonitoringEmployee({
        id: 'x',
        nome: 'X',
        email: null,
        role: 'employee',
        status: 'demitido',
        company_id: 'c1',
      }),
    ).toBe(false);
  });
});
