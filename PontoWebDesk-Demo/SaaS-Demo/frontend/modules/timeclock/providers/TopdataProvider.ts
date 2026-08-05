import type {
  DeviceConfig,
  EmployeePayload,
  TimeClockLogEntry,
  TimeClockProvider,
} from '../interfaces/TimeClockProvider';
import { logPlaceholderOp, notImplemented } from './placeholderUtils';

/** Topdata — estrutura pronta; integração real na próxima fase. */
export class TopdataProvider implements TimeClockProvider {
  readonly vendorKey = 'topdata' as const;

  async connect(config: DeviceConfig): Promise<void> {
    logPlaceholderOp('topdata', 'connect', config);
  }

  async testConnection(config: DeviceConfig): Promise<boolean> {
    logPlaceholderOp('topdata', 'testConnection', config);
    return false;
  }

  async createEmployee(config: DeviceConfig, _data: EmployeePayload): Promise<unknown> {
    void _data;
    logPlaceholderOp('topdata', 'createEmployee', config);
    notImplemented('topdata', 'createEmployee');
  }

  async updateEmployee(config: DeviceConfig, _data: EmployeePayload): Promise<unknown> {
    void _data;
    logPlaceholderOp('topdata', 'updateEmployee', config);
    notImplemented('topdata', 'updateEmployee');
  }

  async deleteEmployee(config: DeviceConfig, _identifier: string): Promise<unknown> {
    void _identifier;
    logPlaceholderOp('topdata', 'deleteEmployee', config);
    notImplemented('topdata', 'deleteEmployee');
  }

  async getLogs(_config: DeviceConfig, _startDate?: Date, _endDate?: Date): Promise<TimeClockLogEntry[]> {
    void _config;
    void _startDate;
    void _endDate;
    notImplemented('topdata', 'getLogs');
  }
}
