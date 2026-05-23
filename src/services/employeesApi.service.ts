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
  cargo?: string | null;
  departamento?: string | null;
  salario?: number | null;
  jornada_tipo?: string | null;
  carga_horaria?: number | null;
  endereco?: string | null;
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
  cargo?: string | null;
  departamento?: string | null;
  salario?: number | null;
  jornada_tipo?: string | null;
  carga_horaria?: number | null;
  endereco?: string | null;
};

export type EmployeeUpdateInput = Partial<EmployeeWriteInput>;

export type EmployeesListResponse = {
  ok?: boolean;
  employees?: ApiEmployee[];
  employee?: ApiEmployee;
  error?: string;
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
  if (input.data_admissao !== undefined) body.data_admissao = input.data_admissao || null;
  if (input.cargo !== undefined) body.cargo = input.cargo?.trim() || null;
  if (input.departamento !== undefined) body.departamento = input.departamento?.trim() || null;
  if (input.salario !== undefined) body.salario = input.salario;
  if (input.jornada_tipo !== undefined) body.jornada_tipo = input.jornada_tipo?.trim() || null;
  if (input.carga_horaria !== undefined) body.carga_horaria = input.carga_horaria;
  if (input.endereco !== undefined) body.endereco = input.endereco?.trim() || null;
  return body;
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
  const err = validateEmployeeFormClient({
    nome: input.nome,
    cpf: input.cpf,
    data_admissao: input.data_admissao ?? undefined,
    salario: input.salario,
    carga_horaria: input.carga_horaria ?? undefined,
    requireCpf: true,
  });
  if (err) throw new Error(err);

  const data = (await apiPost('/employees', toApiBody(input))) as EmployeesListResponse;
  if (!data?.ok || !data?.employee) {
    throw new Error(String(data?.error || 'Erro ao criar colaborador'));
  }
  return normalizeApiEmployee(data.employee);
}

export async function updateEmployee(id: string, input: EmployeeUpdateInput): Promise<ApiEmployee> {
  if (input.cpf != null) {
    const err = validateEmployeeFormClient({
      nome: input.nome || 'x',
      cpf: input.cpf,
      requireCpf: true,
    });
    if (err && err !== 'Nome é obrigatório') throw new Error(err);
  }

  const data = (await apiPatch(
    `/employees/${encodeURIComponent(id)}`,
    toApiBody(input),
  )) as EmployeesListResponse;
  if (!data?.ok || !data?.employee) {
    throw new Error(String(data?.error || 'Erro ao atualizar colaborador'));
  }
  return normalizeApiEmployee(data.employee);
}

export async function deleteEmployee(id: string): Promise<void> {
  const data = (await apiDelete(`/employees/${encodeURIComponent(id)}`)) as EmployeesListResponse;
  if (!data?.ok) {
    throw new Error(String(data?.error || 'Erro ao excluir colaborador'));
  }
}

function normalizeApiEmployee(row: ApiEmployee): ApiEmployee {
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
    data_admissao: row.data_admissao != null ? String(row.data_admissao).slice(0, 10) : null,
    cargo: row.cargo != null ? String(row.cargo) : null,
    departamento: row.departamento != null ? String(row.departamento) : null,
    salario: row.salario != null ? Number(row.salario) : null,
    jornada_tipo: row.jornada_tipo != null ? String(row.jornada_tipo) : null,
    carga_horaria: row.carga_horaria != null ? Number(row.carga_horaria) : null,
    endereco: row.endereco != null ? String(row.endereco) : null,
  };
}
