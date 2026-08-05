import ControlIdAdapter from '../../rep-integration/adapters/controlId';
import { TimeClockError } from '../errors/TimeClockError';
import type {
  DeviceConfig,
  EmployeePayload,
  TimeClockLogEntry,
  TimeClockMutationResult,
  TimeClockProvider,
} from '../interfaces/TimeClockProvider';
import { deviceConfigToRepDevice, employeePayloadToRepEmployeePayload, punchToTimeClockLog } from '../utils/dataAdapters';

/**
 * Control iD — toda a lógica iDClass (*.fcgi) fica no adaptador `adapters/controlId`;
 * aqui só há mapeamento DeviceConfig / EmployeePayload ↔ REP interno.
 */
export class ControlIdProvider implements TimeClockProvider {
  readonly vendorKey = 'control_id' as const;

  private rep(cfg: DeviceConfig) {
    return deviceConfigToRepDevice(cfg);
  }

  async connect(config: DeviceConfig): Promise<void> {
    if (!ControlIdAdapter.testConnection) {
      throw new TimeClockError('Control iD: testConnection não disponível', 'NOT_CONFIGURED', undefined, undefined, 'control_id');
    }
    const r = await ControlIdAdapter.testConnection(this.rep(config));
    if (!r.ok) {
      throw new TimeClockError(
        r.message || 'Falha ao conectar no Control iD',
        'CONNECT_FAILED',
        r.httpStatus,
        r.body,
        'control_id'
      );
    }
  }

  async testConnection(config: DeviceConfig): Promise<boolean> {
    try {
      if (!ControlIdAdapter.testConnection) return false;
      const r = await ControlIdAdapter.testConnection(this.rep(config));
      return r.ok;
    } catch {
      return false;
    }
  }

  async createEmployee(config: DeviceConfig, data: EmployeePayload): Promise<TimeClockMutationResult> {
    if (!ControlIdAdapter.pushEmployee) {
      throw new TimeClockError('Control iD: pushEmployee não disponível', 'NOT_CONFIGURED', undefined, undefined, 'control_id');
    }
    const rep = employeePayloadToRepEmployeePayload(data);
    return ControlIdAdapter.pushEmployee(this.rep(config), rep);
  }

  async updateEmployee(config: DeviceConfig, data: EmployeePayload): Promise<TimeClockMutationResult> {
    return this.createEmployee(config, data);
  }

  async deleteEmployee(config: DeviceConfig, identifier: string): Promise<TimeClockMutationResult> {
    void config;
    void identifier;
    return {
      ok: false,
      message:
        'Exclusão remota de usuário não está implementada para Control iD nesta versão. Remova no próprio relógio ou via utilitário do fabricante.',
    };
  }

  async getEmployees(config: DeviceConfig): Promise<unknown[]> {
    if (!ControlIdAdapter.pullUsersFromDevice) return [];
    const r = await ControlIdAdapter.pullUsersFromDevice(this.rep(config));
    if (!r.ok) {
      throw new TimeClockError(r.message || 'Falha ao listar usuários no Control iD', 'GET_EMPLOYEES_FAILED', undefined, undefined, 'control_id');
    }
    return r.users;
  }

  async getLogs(config: DeviceConfig, startDate?: Date, endDate?: Date): Promise<TimeClockLogEntry[]> {
    const punches = await ControlIdAdapter.fetchPunches(this.rep(config), startDate);
    let rows = punches.map(punchToTimeClockLog);
    if (endDate) {
      const endMs = endDate.getTime();
      rows = rows.filter((r) => {
        const t = new Date(r.data_hora).getTime();
        return Number.isFinite(t) && t <= endMs;
      });
    }
    return rows;
  }
}
