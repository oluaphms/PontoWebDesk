/**
 * Tipos do módulo REP Integration (Enterprise)
 */

export type RepConnectionType = 'rede' | 'arquivo' | 'api';
export type RepDeviceStatus = 'ativo' | 'inativo' | 'erro' | 'sincronizando';
export type RepVendorName = 'controlid' | 'henry' | 'topdata';

export interface RepDeviceConfig {
  id: string;
  company_id: string;
  nome_dispositivo: string;
  nome?: string;
  fabricante?: string | null;
  modelo?: string | null;
  ip?: string | null;
  porta?: number | null;
  usuario?: string | null;
  senha?: string | null;
  tipo_conexao: RepConnectionType;
  status?: RepDeviceStatus | null;
  ultima_sincronizacao?: string | null;
  ativo: boolean;
  config_extra?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
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

export interface DeviceStatusResult {
  ok: boolean;
  message: string;
  lastNsr?: number;
  battery?: number;
  firmware?: string;
}

export interface SyncEmployeeItem {
  pis?: string;
  cpf?: string;
  matricula?: string;
  nome: string;
  cartao?: string;
}

/**
 * Interface comum para adaptadores REP (Control iD, Henry, Topdata)
 */
export interface REPAdapter {
  readonly name: string;
  readonly vendor: RepVendorName;

  connect(device: RepDeviceConfig): Promise<boolean>;

  fetchPunches(device: RepDeviceConfig, lastNSR?: number): Promise<PunchFromDevice[]>;

  syncEmployees?(device: RepDeviceConfig): Promise<SyncEmployeeItem[]>;

  getDeviceStatus(device: RepDeviceConfig): Promise<DeviceStatusResult>;
}
