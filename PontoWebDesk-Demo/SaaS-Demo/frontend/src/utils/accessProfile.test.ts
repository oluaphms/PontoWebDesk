import { describe, expect, it } from 'vitest';
import {
  accessProfileToRole,
  canRegisterPunch,
  hasAdminAccess,
  resolveAccessProfile,
  roleToAccessProfileForm,
} from './accessProfile';

describe('accessProfile', () => {
  it('resolve perfis canônicos', () => {
    expect(resolveAccessProfile('employee')).toBe('COLABORADOR');
    expect(resolveAccessProfile('admin')).toBe('ADMIN_RH');
    expect(resolveAccessProfile('hr')).toBe('ADMIN_RH');
    expect(resolveAccessProfile('admin_gerente')).toBe('ADMIN_GERENTE');
  });

  it('mapeia formulário para role', () => {
    expect(accessProfileToRole('ADMIN_GERENTE')).toBe('admin_gerente');
    expect(accessProfileToRole('ADMIN_RH', 'hr')).toBe('hr');
    expect(accessProfileToRole('COLABORADOR')).toBe('employee');
  });

  it('Admin/Gerente não registra ponto', () => {
    expect(canRegisterPunch('admin_gerente')).toBe(false);
    expect(canRegisterPunch('admin')).toBe(true);
    expect(canRegisterPunch('hr')).toBe(true);
    expect(canRegisterPunch('employee')).toBe(true);
  });

  it('Admin/Gerente tem acesso administrativo', () => {
    expect(hasAdminAccess('admin_gerente')).toBe(true);
    expect(roleToAccessProfileForm('admin_gerente').accessProfile).toBe('ADMIN_GERENTE');
  });
});
