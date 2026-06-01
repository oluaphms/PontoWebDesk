import { describe, expect, it } from 'vitest';
import { isValidCpf, parseDateYmd, validateEmployeeCreate, validateEmployeePatch } from './employeeValidation.js';

describe('employeeValidation', () => {
  it('valida CPF correto', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('rejeita create sem cpf', () => {
    const r = validateEmployeeCreate({ nome: 'João' }, 'company-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('cpf');
  });

  it('aceita create completo', () => {
    const r = validateEmployeeCreate(
      {
        nome: 'Maria Silva',
        cpf: '529.982.247-25',
        email: 'maria@test.com',
        data_admissao: '2024-01-15',
        cargo: 'Analista',
        departamento: 'TI',
        salario: 4500,
        jornada_tipo: '44h_semanais',
        carga_horaria: 8,
        schedule_id: '11111111-1111-4111-8111-111111111111',
        shift_id: '22222222-2222-4222-8222-222222222222',
      },
      'company-1',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.cpf).toBe('52998224725');
      expect(r.data.data_admissao).toBe('2024-01-15');
      expect(r.data.schedule_id).toBe('11111111-1111-4111-8111-111111111111');
      expect(r.data.shift_id).toBe('22222222-2222-4222-8222-222222222222');
    }
  });

  it('parseDateYmd aceita ISO e BR', () => {
    expect(parseDateYmd('2024-03-01')).toBe('2024-03-01');
    expect(parseDateYmd('01/03/2024')).toBe('2024-03-01');
  });

  it('patch parcial só com campos enviados', () => {
    const r = validateEmployeePatch({ cargo: 'Supervisor' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.partial?.cargo).toBe('Supervisor');
  });

  it('aceita vínculos de escala nulos ou UUIDs no patch', () => {
    const r = validateEmployeePatch({
      schedule_id: '',
      shift_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.partial?.schedule_id).toBeNull();
      expect(r.partial?.shift_id).toBe('22222222-2222-4222-8222-222222222222');
    }
  });

  it('rejeita vínculo de escala inválido', () => {
    const r = validateEmployeePatch({ schedule_id: 'agenda-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('schedule_id');
  });
});
