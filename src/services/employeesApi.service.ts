import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import { isValidCpf, stripCpf } from '../utils/cpfValidation';

export type ApiEmployee = {
  id: string;
  nome: string;
  email: string | null;
  role: string;
  status: string;
  company_id: string;
  created_at?: string;
  cpf?: string | null;
  pis?: string | null;
  telefone?: string | null;
  data_admissao?: string | null;
  admissao?: string | null;
  admission_date?: string | null;
  hire_date?: string | null;
  cargo?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  departamento?: string | null;
  schedule_id?: string | null;
  schedule_name?: string | null;
  shift_id?: string | null;
  work_shift_id?: string | null;
  shift_label?: string | null;
  work_shift_label?: string | null;
  estrutura_id?: string | null;
  estrutura_name?: string | null;
  salario?: number | null;
  jornada_tipo?: string | null;
  carga_horaria?: number | null;
  endereco?: string | null;
  numero_folha?: string | null;
  numero_identificador?: string | null;
  demissao?: string | null;
  termination_date?: string | null;
  dismissal_date?: string | null;
  motivo_demissao_id?: string | null;
  motivo_demissao_name?: string | null;
  invisivel?: boolean;
  employee_config?: Record<string, unknown>;
};

export type EmployeeWriteInput = {
  nome: string;
  cpf: string;
  email?: string | null;
  role?: string;
  status?: string;
  companyId?: string;
  pis?: string | null;
  telefone?: string | null;
  data_admissao?: string | null;
  admissao?: string | null;
  admission_date?: string | null;
  hire_date?: string | null;
  cargo?: string | null;
  departamento?: string | null;
  schedule_id?: string | null;
  shift_id?: string | null;
  salario?: number | null;
  jornada_tipo?: string | null;
  carga_horaria?: number | null;
  endereco?: string | null;
  numero_folha?: string | null;
  numero_identificador?: string | null;
  demissao?: string | null;
  termination_date?: string | null;
  dismissal_date?: string | null;
  invisivel?: boolean;
  employee_config?: Record<string, unknown>;
  /** Senha inicial (somente criação). */
  password?: string;
};

export type EmployeeUpdateInput = Partial<Omit<EmployeeWriteInput, 'password'>>;

export type EmployeesListResponse = {
  ok?: boolean;
  employees?: ApiEmployee[];
  employee?: ApiEmployee;
  error?: string;
  message?: string;
  code?: string;
  field?: string;
};

function toApiBody(input: EmployeeWriteInput | EmployeeUpdateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.nome != null) body.nome = input.nome.trim();
  if (input.cpf != null) body.cpf = stripCpf(input.cpf);
  if (input.email !== undefined) body.email = input.email?.trim() || null;
  if (input.role != null) body.role = input.role;
  if (input.status != null) body.status = input.status;
  if (input.companyId != null) body.company_id = input.companyId;
  if (input.pis !== undefined) body.pis = input.pis?.trim() || null;
  if (input.telefone !== undefined) body.telefone = input.telefone?.trim() || null;
  const hasAdmissionField =
    input.data_admissao !== undefined ||
    input.admissao !== undefined ||
    input.admission_date !== undefined ||
    input.hire_date !== undefined;
  if (hasAdmissionField) {
    const normalizedAdmission = normalizeDateInput(
      input.data_admissao ?? input.admissao ?? input.admission_date ?? input.hire_date,
    );
    body.data_admissao = normalizedAdmission;
  }
  if (input.cargo !== undefined) body.cargo = input.cargo?.trim() || null;
  if (input.departamento !== undefined) body.departamento = input.departamento?.trim() || null;
  if (input.schedule_id !== undefined) body.schedule_id = input.schedule_id?.trim() || null;
  if (input.shift_id !== undefined) body.shift_id = input.shift_id?.trim() || null;
  if (input.salario !== undefined) body.salario = input.salario;
  if (input.jornada_tipo !== undefined) body.jornada_tipo = input.jornada_tipo?.trim() || null;
  if (input.carga_horaria !== undefined) body.carga_horaria = input.carga_horaria;
  if (input.endereco !== undefined) body.endereco = input.endereco?.trim() || null;
  if (input.numero_folha !== undefined) body.numero_folha = input.numero_folha?.trim() || null;
  if (input.numero_identificador !== undefined) {
    body.numero_identificador = input.numero_identificador?.trim() || null;
  }
  const hasDismissalField =
    input.demissao !== undefined ||
    input.termination_date !== undefined ||
    input.dismissal_date !== undefined;
  if (hasDismissalField) {
    const normalizedDismissal = normalizeDateInput(
      input.demissao ?? input.termination_date ?? input.dismissal_date,
    );
    body.demissao = normalizedDismissal;
  }
  if (input.invisivel !== undefined) body.invisivel = input.invisivel;
  if (input.employee_config !== undefined) body.employee_config = input.employee_config;
  if ('password' in input && typeof input.password === 'string' && input.password.trim()) {
    body.password = input.password.trim();
  }
  return body;
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function mergeInputScheduleFields(
  employee: ApiEmployee,
  input: EmployeeWriteInput | EmployeeUpdateInput,
): ApiEmployee {
  return {
    ...employee,
    schedule_id:
      employee.schedule_id ??
      (input.schedule_id !== undefined ? normalizeNullableString(input.schedule_id) : null),
    shift_id:
      employee.shift_id ??
      employee.work_shift_id ??
      (input.shift_id !== undefined ? normalizeNullableString(input.shift_id) : null),
  };
}

/** Validação client-side antes do POST/PATCH (espelha regras do backend). */
export function validateEmployeeFormClient(input: {
  nome: string;
  cpf: string;
  data_admissao?: string;
  salario?: number | null;
  carga_horaria?: number | null;
  requireCpf?: boolean;
}): string | null {
  if (!input.nome.trim()) return 'Nome é obrigatório';
  if (input.requireCpf !== false) {
    if (!input.cpf.trim()) return 'CPF é obrigatório';
    if (!isValidCpf(input.cpf)) return 'CPF inválido';
  }
  if (input.data_admissao?.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(input.data_admissao.trim())) {
    return 'Data de admissão inválida (use AAAA-MM-DD)';
  }
  if (input.salario != null && (Number.isNaN(input.salario) || input.salario < 0)) {
    return 'Salário inválido';
  }
  if (input.carga_horaria != null && (input.carga_horaria < 0 || input.carga_horaria > 60)) {
    return 'Carga horária deve ser entre 0 e 60';
  }
  return null;
}

export async function fetchEmployees(companyId: string): Promise<ApiEmployee[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  const q = `?companyId=${encodeURIComponent(cid)}`;
  const data = (await apiGet(`/employees${q}`)) as EmployeesListResponse;
  if (!data?.ok && !data?.employees) {
    throw new Error(String(data?.error || 'Erro ao listar colaboradores'));
  }
  return (data.employees ?? []).map(normalizeApiEmployee);
}

export async function createEmployee(input: EmployeeWriteInput): Promise<ApiEmployee> {
  const normalizedAdmission = normalizeDateInput(
    input.data_admissao ?? input.admissao ?? input.admission_date ?? input.hire_date,
  );
  const err = validateEmployeeFormClient({
    nome: input.nome,
    cpf: input.cpf,
    data_admissao: normalizedAdmission ?? undefined,
    salario: input.salario,
    carga_horaria: input.carga_horaria ?? undefined,
    requireCpf: true,
  });
  if (err) throw new Error(err);

  const data = (await apiPost('/employees', toApiBody(input))) as EmployeesListResponse;
  if (!data?.ok || !data?.employee) {
    throw new Error(String(data?.message || data?.error || data?.code || 'Erro ao criar colaborador'));
  }
  return normalizeApiEmployee(mergeInputScheduleFields(data.employee, input));
}

export async function updateEmployee(id: string, input: EmployeeUpdateInput): Promise<ApiEmployee> {
  const normalizedAdmission = normalizeDateInput(
    input.data_admissao ?? input.admissao ?? input.admission_date ?? input.hire_date,
  );
  if (input.cpf != null) {
    const err = validateEmployeeFormClient({
      nome: input.nome || 'x',
      cpf: input.cpf,
      data_admissao: normalizedAdmission ?? undefined,
      requireCpf: true,
    });
    if (err && err !== 'Nome é obrigatório') throw new Error(err);
  }

  const data = (await apiPatch(
    `/employees/${encodeURIComponent(id)}`,
    toApiBody(input),
  )) as EmployeesListResponse;
  if (!data?.ok || !data?.employee) {
    throw new Error(String(data?.message || data?.error || data?.code || 'Erro ao atualizar colaborador'));
  }
  return normalizeApiEmployee(mergeInputScheduleFields(data.employee, input));
}

export async function deleteEmployee(id: string): Promise<void> {
  const data = (await apiDelete(`/employees/${encodeURIComponent(id)}`)) as EmployeesListResponse;
  if (!data?.ok) {
    throw new Error(String(data?.message || data?.error || data?.code || 'Erro ao excluir colaborador'));
  }
}

function normalizeApiEmployee(row: ApiEmployee): ApiEmployee {
  const normalizedAdmission = normalizeDateInput(
    row.data_admissao ?? row.admissao ?? row.admission_date ?? row.hire_date,
  );
  const normalizedDismissal = normalizeDateInput(
    row.demissao ?? row.termination_date ?? row.dismissal_date,
  );
  return {
    id: String(row.id ?? ''),
    nome: String(row.nome ?? ''),
    email: row.email != null ? String(row.email) : null,
    role: String(row.role ?? 'employee'),
    status: String(row.status ?? 'active'),
    company_id: String(row.company_id ?? ''),
    created_at: row.created_at != null ? String(row.created_at) : undefined,
    cpf: row.cpf != null ? String(row.cpf) : null,
    pis: row.pis != null ? String(row.pis) : null,
    telefone: row.telefone != null ? String(row.telefone) : null,
    data_admissao: normalizedAdmission,
    admissao: normalizedAdmission,
    admission_date: normalizedAdmission,
    hire_date: normalizedAdmission,
    cargo: row.cargo != null ? String(row.cargo) : null,
    department_id: normalizeNullableString(row.department_id),
    department_name: normalizeNullableString(row.department_name),
    departamento: row.departamento != null ? String(row.departamento) : null,
    schedule_id: normalizeNullableString(row.schedule_id),
    schedule_name: normalizeNullableString(row.schedule_name),
    shift_id: normalizeNullableString(row.shift_id ?? row.work_shift_id),
    work_shift_id: normalizeNullableString(row.work_shift_id ?? row.shift_id),
    shift_label: normalizeNullableString(row.shift_label ?? row.work_shift_label),
    work_shift_label: normalizeNullableString(row.work_shift_label ?? row.shift_label),
    estrutura_id: normalizeNullableString(row.estrutura_id),
    estrutura_name: normalizeNullableString(row.estrutura_name),
    salario: row.salario != null ? Number(row.salario) : null,
    jornada_tipo: row.jornada_tipo != null ? String(row.jornada_tipo) : null,
    carga_horaria: row.carga_horaria != null ? Number(row.carga_horaria) : null,
    endereco: row.endereco != null ? String(row.endereco) : null,
    numero_folha: row.numero_folha != null ? String(row.numero_folha) : null,
    numero_identificador: row.numero_identificador != null ? String(row.numero_identificador) : null,
    demissao: normalizedDismissal,
    termination_date: normalizedDismissal,
    dismissal_date: normalizedDismissal,
    motivo_demissao_id: normalizeNullableString(row.motivo_demissao_id),
    motivo_demissao_name: normalizeNullableString(row.motivo_demissao_name),
    invisivel: row.invisivel === true,
    employee_config:
      row.employee_config && typeof row.employee_config === 'object'
        ? (row.employee_config as Record<string, unknown>)
        : {},
  };
}

function normalizeDateInput(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s].*$)/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    return `${br[3]}-${mm}-${dd}`;
  }

  if (!/\d{4}/.test(raw)) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
