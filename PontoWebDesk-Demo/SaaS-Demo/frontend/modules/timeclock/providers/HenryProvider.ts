import type {
  DeviceConfig,
  EmployeePayload,
  TimeClockLogEntry,
  TimeClockProvider,
} from '../interfaces/TimeClockProvider';
import { logPlaceholderOp, notImplemented } from './placeholderUtils';

/** Henry — estrutura pronta; integração HTTP/SDK real na próxima fase. */
export class HenryProvider implements TimeClockProvider {
  readonly vendorKey = 'henry' as const;

  async connect(config: DeviceConfig): Promise<void> {
    logPlaceholderOp('henry', 'connect', config);
  }

  async testConnection(config: DeviceConfig): Promise<boolean> {
    logPlaceholderOp('henry', 'testConnection', config);
    return false;
  }

  async createEmployee(config: DeviceConfig, _data: EmployeePayload): Promise<unknown> {
    void _data;
    logPlaceholderOp('henry', 'createEmployee', config);
    notImplemented('henry', 'createEmployee');
  }

  async updateEmployee(config: DeviceConfig, _data: EmployeePayload): Promise<unknown> {
    void _data;
    logPlaceholderOp('henry', 'updateEmployee', config);
    notImplemented('henry', 'updateEmployee');
  }

  async deleteEmployee(config: DeviceConfig, _identifier: string): Promise<unknown> {
    void _identifier;
    logPlaceholderOp('henry', 'deleteEmployee', config);
    notImplemented('henry', 'deleteEmployee');
  }

  async getLogs(_config: DeviceConfig, _startDate?: Date, _endDate?: Date): Promise<TimeClockLogEntry[]> {
    void _config;
    void _startDate;
    void _endDate;
    notImplemented('henry', 'getLogs');
  }
}
