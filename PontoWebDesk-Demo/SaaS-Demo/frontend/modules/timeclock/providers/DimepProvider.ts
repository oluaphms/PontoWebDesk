import type {
  DeviceConfig,
  EmployeePayload,
  TimeClockLogEntry,
  TimeClockProvider,
} from '../interfaces/TimeClockProvider';
import { logPlaceholderOp, notImplemented } from './placeholderUtils';

/** Dimep — estrutura pronta; integração real na próxima fase. */
export class DimepProvider implements TimeClockProvider {
  readonly vendorKey = 'dimep' as const;

  async connect(config: DeviceConfig): Promise<void> {
    logPlaceholderOp('dimep', 'connect', config);
  }

  async testConnection(config: DeviceConfig): Promise<boolean> {
    logPlaceholderOp('dimep', 'testConnection', config);
    return false;
  }

  async createEmployee(config: DeviceConfig, _data: EmployeePayload): Promise<unknown> {
    void _data;
    logPlaceholderOp('dimep', 'createEmployee', config);
    notImplemented('dimep', 'createEmployee');
  }

  async updateEmployee(config: DeviceConfig, _data: EmployeePayload): Promise<unknown> {
    void _data;
    logPlaceholderOp('dimep', 'updateEmployee', config);
    notImplemented('dimep', 'updateEmployee');
  }

  async deleteEmployee(config: DeviceConfig, _identifier: string): Promise<unknown> {
    void _identifier;
    logPlaceholderOp('dimep', 'deleteEmployee', config);
    notImplemented('dimep', 'deleteEmployee');
  }

  async getLogs(_config: DeviceConfig, _startDate?: Date, _endDate?: Date): Promise<TimeClockLogEntry[]> {
    void _config;
    void _startDate;
    void _endDate;
    notImplemented('dimep', 'getLogs');
  }
}
