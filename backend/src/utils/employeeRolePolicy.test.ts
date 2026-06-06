import { describe, expect, it } from 'vitest';
import {
  normalizeAssignableEmployeeRole,
  validateEmployeeRoleAssignment,
} from './employeeRolePolicy.js';

describe('employeeRolePolicy', () => {
  it('normaliza aliases legados', () => {
    expect(normalizeAssignableEmployeeRole('colaborador')).toBe('employee');
    expect(normalizeAssignableEmployeeRole('administrador')).toBe('admin');
    expect(normalizeAssignableEmployeeRole('rh')).toBe('hr');
  });

  it('bloqueia colaborador de atribuir admin', () => {
    const result = validateEmployeeRoleAssignment('admin', 'employee');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMPLOYEE_ROLE_FORBIDDEN');
  });

  it('permite admin atribuir hr', () => {
    const result = validateEmployeeRoleAssignment('hr', 'admin');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('hr');
  });
});
