/**
 * Tipos do módulo de integração REP (Registrador Eletrônico de Ponto)
 */

export type RepConnectionType = 'rede' | 'arquivo' | 'api';
export type RepDeviceStatus = 'ativo' | 'inativo' | 'erro' | 'sincronizando';

export interface RepDevice {
  id: string;
  company_id: string;
  nome_dispositivo: string;
  /** Slug do hub multi-fabricante: control_id | dimep | topdata | henry (opcional; senão usa heurística de fabricante). */
  provider_type?: string | null;
  /** Regra de identificação do colaborador para este relógio. */
  identifier_type?: 'pis' | 'cpf' | 'both' | null;
  fabricante?: string | null;
  modelo?: string | null;
  ip?: string | null;
  porta?: number | null;
  tipo_conexao: RepConnectionType;
  status?: RepDeviceStatus | null;
  ultima_sincronizacao?: string | null;
  ativo: boolean;
  config_extra?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface RepPunchLog {
  id: string;
  company_id: string;
  rep_device_id?: string | null;
  pis?: string | null;
  cpf?: string | null;
  matricula?: string | null;
  nome_funcionario?: string | null;
  data_hora: string;
  tipo_marcacao: string;
  nsr?: number | null;
  origem: string;
  raw_data?: Record<string, unknown> | null;
  time_record_id?: string | null;
  created_at?: string;
}

export interface ParsedAfdRecord {
  nsr: number;
  data: string;
  hora: string;
  cpfOuPis: string;
  tipo: string;
  raw?: string;
}

export interface RepConnectionTestResult {
  ok: boolean;
  message: string;
  httpStatus?: number;
  body?: unknown;
}

/** Dados do funcionário para cadastro no relógio (fabricantes que suportam envio). */
export interface RepEmployeePayload {
  /** ID interno (ex.: users.id) para correlacionar no hub TimeClock. */
  id?: string;
  nome: string;
  cpf?: string | null;
  pis?: string | null;
  matricula?: string | null;
}

/** Usuário lido do relógio (ex.: Control iD load_users). */
export interface RepUserFromDevice {
  nome: string;
  pis?: string;
  cpf?: string;
  matricula?: string;
  raw?: Record<string, unknown>;
}

/** Data/hora local para set_system_date_time (Control iD). */
export interface RepDeviceClockSet {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  /** Modo 671: ex. "-0300" */
  timezone?: string;
}

export type RepExchangeOp = 'pull_clock' | 'push_clock' | 'pull_info' | 'pull_users';

export interface RepVendorAdapter {
  name: string;
  fetchPunches(device: RepDevice, since?: Date): Promise<PunchFromDevice[]>;
  /** API nativa do fabricante (ex.: Control iD iDClass — login.fcgi + get_info.fcgi). */
  testConnection?(device: RepDevice): Promise<RepConnectionTestResult>;
  /** Cadastra funcionário no aparelho (ex.: Control iD — add_users.fcgi). */
  pushEmployee?(device: RepDevice, employee: RepEmployeePayload): Promise<{ ok: boolean; message: string }>;
  /** Lê data/hora do relógio. */
  pullClock?(device: RepDevice): Promise<{ ok: boolean; message?: string; data?: unknown }>;
  /** Ajusta data/hora no relógio. */
  pushClock?(device: RepDevice, clock: RepDeviceClockSet): Promise<{ ok: boolean; message: string }>;
  /** Resumo de hardware / cadastros (ex.: get_info). */
  pullDeviceInfo?(device: RepDevice): Promise<{ ok: boolean; message?: string; data?: unknown }>;
  /** Lista funcionários cadastrados no relógio. */
  pullUsersFromDevice?(device: RepDevice): Promise<{ ok: boolean; message?: string; users: RepUserFromDevice[] }>;
}

export interface PunchFromDevice {
  pis?: string;
  cpf?: string;
  matricula?: string;
  nome?: string;
  data_hora: string;
  tipo: string;
  nsr?: number;
  raw?: Record<string, unknown>;
}
