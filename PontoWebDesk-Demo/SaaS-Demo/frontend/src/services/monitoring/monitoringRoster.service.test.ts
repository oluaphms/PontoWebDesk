import { describe, expect, it } from 'vitest';
import {
  buildMonitoringRoster,
  buildMonitoringRosterWithFallback,
  buildRecordUserToRosterIdMap,
  filterRecordsForRosterMember,
  isActiveMonitoringEmployee,
} from './monitoringRoster.service';

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

  it('fallback para users quando API de colaboradores vem vazia', () => {
    const { roster } = buildMonitoringRosterWithFallback(
      [],
      [
        { id: 'u1', nome: 'Ana', email: 'ana@x.com', role: 'employee', status: 'active' },
        { id: 'u-admin', nome: 'Admin', email: 'admin@x.com', role: 'admin', status: 'active' },
      ],
    );
    expect(roster).toHaveLength(1);
    expect(roster[0]?.id).toBe('u1');
  });

  it('mapeia batida gravada em employees.id para colaborador do roster (users)', () => {
    const roster = [{ id: 'u1', nome: 'Ana', email: 'ana@x.com' }];
    const aliases = new Map([['u1', ['u1']]]);
    const employees = [
      { id: 'emp-ana', nome: 'Ana', email: 'ana@x.com', role: 'employee', status: 'active', company_id: 'c1' },
    ];
    const users = [{ id: 'u1', nome: 'Ana', email: 'ana@x.com', role: 'employee', status: 'active' }];
    const map = buildRecordUserToRosterIdMap(roster, aliases, employees, users);
    expect(map.get('emp-ana')).toBe('u1');
    const matched = filterRecordsForRosterMember(
      [{ id: 'r1', user_id: 'emp-ana', type: 'entrada', created_at: '2026-06-17T10:00:00.000Z', timestamp: '2026-06-17T10:00:00.000Z' }],
      'u1',
      aliases,
      map,
    );
    expect(matched).toHaveLength(1);
  });
});
