/** Marcas do hub (extensível). */
export type TimeClockProviderKey = 'control_id' | 'dimep' | 'topdata' | 'henry';

/**
 * Configuração canônica do dispositivo para o hub TimeClock (independente da tabela de origem).
 */
export type DeviceConfig = {
  id: string;
  companyId: string;
  providerType: TimeClockProviderKey;
  ip?: string | null;
  port?: number | null;
  tipoConexao?: 'rede' | 'arquivo' | 'api';
  displayName?: string | null;
  username?: string | null;
  password?: string | null;
  extra?: Record<string, unknown> | null;
};

/** Modelo canônico de colaborador (nunca formato bruto do fabricante). */
export type EmployeePayload = {
  id: string;
  name: string;
  pis: string;
  registration: string;
  password?: string;
  card?: string;
  cpf?: string;
};

export type TimeClockLogEntry = {
  id?: string;
  employeeKey?: string;
  pis?: string;
  cpf?: string;
  matricula?: string;
  nome?: string;
  data_hora: string;
  tipo: string;
  nsr?: number;
  raw?: Record<string, unknown>;
};

export type TimeClockMutationResult = { ok: boolean; message: string };

/**
 * Contrato único por fabricante. O núcleo do sistema só orquestra via `TimeClockService` + factory.
 * Implementações isolam protocolo HTTP/SDK/firmware.
 */
export interface TimeClockProvider {
  readonly vendorKey: TimeClockProviderKey;

  connect(config: DeviceConfig): Promise<void>;

  /** Retorna `true` se o handshake com o aparelho foi bem-sucedido. */
  testConnection(config: DeviceConfig): Promise<boolean>;

  createEmployee(config: DeviceConfig, data: EmployeePayload): Promise<unknown>;

  updateEmployee(config: DeviceConfig, data: EmployeePayload): Promise<unknown>;

  deleteEmployee(config: DeviceConfig, identifier: string): Promise<unknown>;

  getEmployees?(config: DeviceConfig): Promise<unknown[]>;

  getLogs(config: DeviceConfig, startDate?: Date, endDate?: Date): Promise<TimeClockLogEntry[]>;
}
