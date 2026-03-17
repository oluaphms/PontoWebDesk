/**
 * Tipos do módulo de integração REP (Registrador Eletrônico de Ponto)
 */

export type RepConnectionType = 'rede' | 'arquivo' | 'api';
export type RepDeviceStatus = 'ativo' | 'inativo' | 'erro' | 'sincronizando';

export interface RepDevice {
  id: string;
  company_id: string;
  nome_dispositivo: string;
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

export interface RepVendorAdapter {
  name: string;
  fetchPunches(device: RepDevice, since?: Date): Promise<PunchFromDevice[]>;
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
