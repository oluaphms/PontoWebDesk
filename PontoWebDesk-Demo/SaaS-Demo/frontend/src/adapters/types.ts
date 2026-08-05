/**
 * Contratos da camada Adapter para relógios de ponto (multi-marca).
 */

export type ClockBrand = 'controlid' | 'dimep' | 'henry' | 'topdata';

export interface DeviceConfig {
  id: string;
  /** Obrigatório para normalização e envio ao Supabase. */
  company_id: string;
  brand: ClockBrand;
  ip: string;
  port?: number;
  username?: string;
  password?: string;
  /** Extensões (HTTPS, tls_insecure, timezone AFD, caminho de arquivo, etc.). */
  extra?: Record<string, unknown>;
}

export interface NormalizedRecord {
  employee_id: string;
  timestamp: string;
  event_type: string;
  device_id: string;
  company_id: string;
  raw: Record<string, unknown>;
}

export interface ClockAdapter {
  fetch(device: DeviceConfig, lastSync?: string): Promise<NormalizedRecord[]>;
}
