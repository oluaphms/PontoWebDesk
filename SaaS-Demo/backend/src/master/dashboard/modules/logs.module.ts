/**
 * Logs do Master Dashboard — in-memory (sem banco).
 */
import { randomUUID } from 'node:crypto';
import type {
  DashboardLogEntry,
  DashboardLogLevel,
  MasterDashboardModuleId,
} from '../dashboard.types.js';

export type AppendLogInput = {
  module: MasterDashboardModuleId | 'system';
  level?: DashboardLogLevel;
  action: string;
  message: string;
  meta?: Record<string, unknown>;
};

export class DashboardLogsModule {
  private readonly entries: DashboardLogEntry[] = [];

  async append(input: AppendLogInput): Promise<DashboardLogEntry> {
    const entry: DashboardLogEntry = {
      id: `log_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      module: input.module,
      level: input.level ?? 'info',
      action: input.action,
      message: input.message,
      at: new Date().toISOString(),
      meta: input.meta,
    };
    this.entries.unshift(entry);
    if (this.entries.length > 2000) this.entries.length = 2000;
    return { ...entry };
  }

  async list(limit = 100): Promise<DashboardLogEntry[]> {
    return this.entries.slice(0, Math.max(1, limit)).map((e) => ({ ...e }));
  }

  async listByModule(
    module: MasterDashboardModuleId | 'system',
    limit = 100,
  ): Promise<DashboardLogEntry[]> {
    return this.entries
      .filter((e) => e.module === module)
      .slice(0, Math.max(1, limit))
      .map((e) => ({ ...e }));
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
