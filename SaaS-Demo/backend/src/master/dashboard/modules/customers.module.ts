/**
 * Módulo Clientes do Master Dashboard.
 */
import type { CustomerService } from '../../services/CustomerService.js';
import type { MasterCustomer } from '../../types.js';
import type { DashboardLogsModule } from './logs.module.js';

export class CustomersModule {
  constructor(
    private readonly customers: CustomerService,
    private readonly logs: DashboardLogsModule,
  ) {}

  async list(): Promise<MasterCustomer[]> {
    return this.customers.list();
  }

  async get(id: string): Promise<MasterCustomer> {
    return this.customers.get(id);
  }

  async create(input: { name: string; email: string; document?: string | null }) {
    const row = await this.customers.create(input);
    await this.logs.append({
      module: 'customers',
      action: 'CUSTOMER_CREATED',
      message: `Cliente criado: ${row.email}`,
      meta: { customerId: row.id },
    });
    return row;
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }
}
