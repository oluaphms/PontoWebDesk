import { normalizeAssignableEmployeeRole } from './employeeRolePolicy.js';

export type EmployeeBody = {
  nome?: unknown;
  cpf?: unknown;
  pis?: unknown;
  telefone?: unknown;
  email?: unknown;
  role?: unknown;
  status?: unknown;
  company_id?: unknown;
  data_admissao?: unknown;
  cargo?: unknown;
  departamento?: unknown;
  salario?: unknown;
  jornada_tipo?: unknown;
  carga_horaria?: unknown;
  endereco?: unknown;
  schedule_id?: unknown;
  shift_id?: unknown;
};

export type ValidationResult =
  | { ok: true; data: NormalizedEmployeeInput }
  | { ok: false; error: string; field?: string };

export type NormalizedEmployeeInput = {
  nome: string;
  cpf: string;
  pis: string | null;
  telefone: string | null;
  email: string | null;
  role: string;
  status: string;
  data_admissao: string | null;
  cargo: string | null;
  departamento: string | null;
  salario: number | null;
  jornada_tipo: string | null;
  carga_horaria: number | null;
  endereco: string | null;
  schedule_id: string | null;
  shift_id: string | null;
};

export function stripCpf(cpf: string): string {
  return String(cpf || '').replace(/\D/g, '');
}

export function isValidCpf(cpf: string): boolean {
  const s = stripCpf(cpf);
  if (s.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== parseInt(s[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(s[i], 10) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === parseInt(s[10], 10);
}

export function parseDateYmd(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : raw;
  }
  const br = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (br) {
    const y = br[3];
    const m = br[2].padStart(2, '0');
    const day = br[1].padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

function parseSalario(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function parseCargaHoraria(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = parseInt(String(value).replace(/\D/g, ''), 10);
  if (Number.isNaN(n) || n < 0 || n > 60) return null;
  return n;
}

function parseNullableUuid(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

/** Validação para POST (criação) — cpf e nome obrigatórios. */
export function validateEmployeeCreate(body: EmployeeBody, companyId: string): ValidationResult {
  const nome = String(body.nome || '').trim();
  if (!nome) return { ok: false, error: 'Nome é obrigatório', field: 'nome' };

  const cid = String(companyId || body.company_id || '').trim();
  if (!cid) return { ok: false, error: 'company_id é obrigatório', field: 'company_id' };

  const cpfRaw = String(body.cpf || '').trim();
  if (!cpfRaw) return { ok: false, error: 'CPF é obrigatório', field: 'cpf' };
  if (!isValidCpf(cpfRaw)) return { ok: false, error: 'CPF inválido', field: 'cpf' };

  const dataAdmissao = parseDateYmd(body.data_admissao);
  if (body.data_admissao != null && String(body.data_admissao).trim() && !dataAdmissao) {
    return { ok: false, error: 'data_admissao inválida (use AAAA-MM-DD)', field: 'data_admissao' };
  }

  const salario = parseSalario(body.salario);
  if (body.salario != null && String(body.salario).trim() && salario === null) {
    return { ok: false, error: 'Salário inválido', field: 'salario' };
  }

  const carga = parseCargaHoraria(body.carga_horaria);
  if (body.carga_horaria != null && String(body.carga_horaria).trim() && carga === null) {
    return { ok: false, error: 'Carga horária inválida (0–60)', field: 'carga_horaria' };
  }

  const scheduleId = parseNullableUuid(body.schedule_id);
  if (body.schedule_id != null && String(body.schedule_id).trim() && scheduleId === null) {
    return { ok: false, error: 'schedule_id inválido', field: 'schedule_id' };
  }

  const shiftId = parseNullableUuid(body.shift_id);
  if (body.shift_id != null && String(body.shift_id).trim() && shiftId === null) {
    return { ok: false, error: 'shift_id inválido', field: 'shift_id' };
  }

  return {
    ok: true,
    data: normalizeEmployeeFields(body, { nome, cpf: stripCpf(cpfRaw), dataAdmissao, salario, carga, scheduleId, shiftId }),
  };
}

/** Validação para PATCH — apenas campos enviados. */
export function validateEmployeePatch(
  body: EmployeeBody,
): ValidationResult & { partial?: Partial<NormalizedEmployeeInput> } {
  const partial: Partial<NormalizedEmployeeInput> = {};
  const keys = Object.keys(body) as (keyof EmployeeBody)[];

  if (keys.length === 0) {
    return { ok: false, error: 'Nenhum campo para atualizar' };
  }

  if ('nome' in body) {
    const nome = String(body.nome ?? '').trim();
    if (!nome) return { ok: false, error: 'Nome não pode ser vazio', field: 'nome' };
    partial.nome = nome;
  }

  if ('cpf' in body) {
    const raw = String(body.cpf ?? '').trim();
    if (!raw) return { ok: false, error: 'CPF não pode ser vazio', field: 'cpf' };
    if (!isValidCpf(raw)) return { ok: false, error: 'CPF inválido', field: 'cpf' };
    partial.cpf = stripCpf(raw);
  }

  if ('data_admissao' in body) {
    if (body.data_admissao == null || body.data_admissao === '') {
      partial.data_admissao = null;
    } else {
      const parsed = parseDateYmd(body.data_admissao);
      if (!parsed) return { ok: false, error: 'data_admissao inválida', field: 'data_admissao' };
      partial.data_admissao = parsed;
    }
  }

  if ('salario' in body) {
    const salario = parseSalario(body.salario);
    if (body.salario != null && String(body.salario).trim() && salario === null) {
      return { ok: false, error: 'Salário inválido', field: 'salario' };
    }
    partial.salario = salario;
  }

  if ('carga_horaria' in body) {
    const carga = parseCargaHoraria(body.carga_horaria);
    if (body.carga_horaria != null && String(body.carga_horaria).trim() && carga === null) {
      return { ok: false, error: 'Carga horária inválida', field: 'carga_horaria' };
    }
    partial.carga_horaria = carga;
  }

  if ('schedule_id' in body) {
    const scheduleId = parseNullableUuid(body.schedule_id);
    if (body.schedule_id != null && String(body.schedule_id).trim() && scheduleId === null) {
      return { ok: false, error: 'schedule_id inválido', field: 'schedule_id' };
    }
    partial.schedule_id = scheduleId;
  }

  if ('shift_id' in body) {
    const shiftId = parseNullableUuid(body.shift_id);
    if (body.shift_id != null && String(body.shift_id).trim() && shiftId === null) {
      return { ok: false, error: 'shift_id inválido', field: 'shift_id' };
    }
    partial.shift_id = shiftId;
  }

  if ('pis' in body) {
    partial.pis = body.pis == null || body.pis === '' ? null : String(body.pis).trim();
  }
  if ('telefone' in body) {
    partial.telefone =
      body.telefone == null || body.telefone === '' ? null : String(body.telefone).trim();
  }
  if ('email' in body) {
    partial.email =
      body.email == null || body.email === '' ? null : String(body.email).trim().toLowerCase();
  }
  if ('role' in body) {
    partial.role = normalizeAssignableEmployeeRole(body.role);
  }
  if ('status' in body) partial.status = String(body.status || 'active').trim() || 'active';
  if ('cargo' in body) {
    partial.cargo = body.cargo == null || body.cargo === '' ? null : String(body.cargo).trim();
  }
  if ('departamento' in body) {
    partial.departamento =
      body.departamento == null || body.departamento === '' ? null : String(body.departamento).trim();
  }
  if ('jornada_tipo' in body) {
    partial.jornada_tipo =
      body.jornada_tipo == null || body.jornada_tipo === ''
        ? null
        : String(body.jornada_tipo).trim();
  }
  if ('endereco' in body) {
    partial.endereco =
      body.endereco == null || body.endereco === '' ? null : String(body.endereco).trim();
  }

  return {
    ok: true,
    data: { ...emptyEmployee(), ...partial },
    partial,
  };
}

function emptyEmployee(): NormalizedEmployeeInput {
  return {
    nome: '',
    cpf: '',
    pis: null,
    telefone: null,
    email: null,
    role: 'employee',
    status: 'active',
    data_admissao: null,
    cargo: null,
    departamento: null,
    salario: null,
    jornada_tipo: null,
    carga_horaria: null,
    endereco: null,
    schedule_id: null,
    shift_id: null,
  };
}

function normalizeEmployeeFields(
  body: EmployeeBody,
  overrides: {
    nome?: string;
    cpf?: string;
    dataAdmissao?: string | null;
    salario?: number | null;
    carga?: number | null;
    scheduleId?: string | null;
    shiftId?: string | null;
  },
): NormalizedEmployeeInput {
  const email =
    body.email !== undefined
      ? body.email == null || body.email === ''
        ? null
        : String(body.email).trim().toLowerCase()
      : null;

  return {
    nome: overrides.nome ?? String(body.nome || '').trim(),
    cpf: overrides.cpf ?? stripCpf(String(body.cpf || '')),
    pis: body.pis != null && String(body.pis).trim() ? String(body.pis).trim() : null,
    telefone: body.telefone != null && String(body.telefone).trim() ? String(body.telefone).trim() : null,
    email,
    role: normalizeAssignableEmployeeRole(body.role),
    status: String(body.status || 'active').trim() || 'active',
    data_admissao: overrides.dataAdmissao !== undefined ? overrides.dataAdmissao : parseDateYmd(body.data_admissao),
    cargo: body.cargo != null && String(body.cargo).trim() ? String(body.cargo).trim() : null,
    departamento:
      body.departamento != null && String(body.departamento).trim() ? String(body.departamento).trim() : null,
    salario: overrides.salario !== undefined ? overrides.salario : parseSalario(body.salario),
    jornada_tipo:
      body.jornada_tipo != null && String(body.jornada_tipo).trim() ? String(body.jornada_tipo).trim() : null,
    carga_horaria: overrides.carga !== undefined ? overrides.carga : parseCargaHoraria(body.carga_horaria),
    endereco: body.endereco != null && String(body.endereco).trim() ? String(body.endereco).trim() : null,
    schedule_id: overrides.scheduleId !== undefined ? overrides.scheduleId : parseNullableUuid(body.schedule_id),
    shift_id: overrides.shiftId !== undefined ? overrides.shiftId : parseNullableUuid(body.shift_id),
  };
}

export const EMPLOYEE_SELECT_COLUMNS = `
  id, nome, email, role, status, company_id, created_at,
  cpf, pis, telefone, data_admissao, cargo, departamento,
  salario, jornada_tipo, carga_horaria, endereco
`.trim();
