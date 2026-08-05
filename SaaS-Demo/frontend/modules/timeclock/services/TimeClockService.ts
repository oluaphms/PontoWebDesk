import type { DeviceConfig, EmployeePayload, TimeClockLogEntry, TimeClockProvider } from '../interfaces/TimeClockProvider';
import { TimeClockError, isTimeClockError } from '../errors/TimeClockError';
import { logTimeClockOp } from '../utils/timeClockLogger';

/**
 * Orquestração: delega ao `TimeClockProvider`, padroniza logs e erros.
 *
 * @example
 * ```ts
 * import { getProvider } from '../timeclock/factory/providerFactory';
 * import { TimeClockService } from '../timeclock/services/TimeClockService';
 * import { repDeviceToDeviceConfig, repEmployeePayloadToEmployeePayload } from '../timeclock/utils/dataAdapters';
 *
 * const svc = new TimeClockService(getProvider('control_id'));
 * const cfg = repDeviceToDeviceConfig(device, 'control_id');
 * await svc.connect(cfg);
 * await svc.syncEmployee(cfg, repEmployeePayloadToEmployeePayload({ ... }));
 * ```
 */
export class TimeClockService {
  constructor(private readonly provider: TimeClockProvider) {}

  get activeVendor(): string {
    return this.provider.vendorKey;
  }

  private baseLog(config: DeviceConfig, op: string, durationMs: number, payload?: unknown, response?: unknown): void {
    logTimeClockOp({
      provider: this.provider.vendorKey,
      op,
      deviceId: config.id,
      deviceIp: config.ip ?? undefined,
      durationMs,
      payload,
      response,
    });
  }

  async connect(config: DeviceConfig): Promise<void> {
    const t0 = Date.now();
    try {
      await this.provider.connect(config);
      this.baseLog(config, 'connect', Date.now() - t0, { ip: config.ip, port: config.port }, { ok: true });
    } catch (e: unknown) {
      this.baseLog(config, 'connect', Date.now() - t0, { ip: config.ip, port: config.port }, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw normalizeError(e, this.provider.vendorKey);
    }
  }

  async testConnection(config: DeviceConfig): Promise<boolean> {
    const t0 = Date.now();
    try {
      const ok = await this.provider.testConnection(config);
      this.baseLog(config, 'testConnection', Date.now() - t0, { ip: config.ip, port: config.port }, { ok });
      return ok;
    } catch (e: unknown) {
      this.baseLog(config, 'testConnection', Date.now() - t0, undefined, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }

  async createEmployee(config: DeviceConfig, employee: EmployeePayload): Promise<unknown> {
    const t0 = Date.now();
    try {
      const result = await this.provider.createEmployee(config, employee);
      this.baseLog(config, 'createEmployee', Date.now() - t0, employee, result);
      return result;
    } catch (e: unknown) {
      this.baseLog(config, 'createEmployee', Date.now() - t0, employee, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw normalizeError(e, this.provider.vendorKey);
    }
  }

  async updateEmployee(config: DeviceConfig, employee: EmployeePayload): Promise<unknown> {
    const t0 = Date.now();
    try {
      const result = await this.provider.updateEmployee(config, employee);
      this.baseLog(config, 'updateEmployee', Date.now() - t0, employee, result);
      return result;
    } catch (e: unknown) {
      this.baseLog(config, 'updateEmployee', Date.now() - t0, employee, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw normalizeError(e, this.provider.vendorKey);
    }
  }

  async deleteEmployee(config: DeviceConfig, identifier: string): Promise<unknown> {
    const t0 = Date.now();
    try {
      const result = await this.provider.deleteEmployee(config, identifier);
      this.baseLog(config, 'deleteEmployee', Date.now() - t0, { identifier }, result);
      return result;
    } catch (e: unknown) {
      this.baseLog(config, 'deleteEmployee', Date.now() - t0, { identifier }, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw normalizeError(e, this.provider.vendorKey);
    }
  }

  async getEmployees(config: DeviceConfig): Promise<unknown[]> {
    const t0 = Date.now();
    try {
      if (!this.provider.getEmployees) {
        return [];
      }
      const rows = await this.provider.getEmployees(config);
      this.baseLog(config, 'getEmployees', Date.now() - t0, undefined, { count: rows.length });
      return rows;
    } catch (e: unknown) {
      this.baseLog(config, 'getEmployees', Date.now() - t0, undefined, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw normalizeError(e, this.provider.vendorKey);
    }
  }

  async getLogs(config: DeviceConfig, startDate?: Date, endDate?: Date): Promise<TimeClockLogEntry[]> {
    const t0 = Date.now();
    try {
      const logs = await this.provider.getLogs(config, startDate, endDate);
      this.baseLog(config, 'getLogs', Date.now() - t0, { startDate, endDate }, { count: logs.length });
      return logs;
    } catch (e: unknown) {
      this.baseLog(config, 'getLogs', Date.now() - t0, { startDate, endDate }, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw normalizeError(e, this.provider.vendorKey);
    }
  }

  /** Alias semântico para cadastro no relógio. */
  async syncEmployee(config: DeviceConfig, employee: EmployeePayload): Promise<unknown> {
    return this.createEmployee(config, employee);
  }

  /** Alias para leitura de marcações. */
  async syncLogs(config: DeviceConfig, startDate?: Date, endDate?: Date): Promise<TimeClockLogEntry[]> {
    return this.getLogs(config, startDate, endDate);
  }
}

function normalizeError(e: unknown, vendor: string): TimeClockError {
  if (isTimeClockError(e)) return e;
  if (e instanceof Error) return new TimeClockError(e.message, 'WRAPPED', undefined, undefined, vendor);
  return new TimeClockError(String(e), 'WRAPPED', undefined, undefined, vendor);
}
