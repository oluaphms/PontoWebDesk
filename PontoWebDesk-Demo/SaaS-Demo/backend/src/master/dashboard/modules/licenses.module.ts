/**
 * Módulo Licenças do Master Dashboard.
 */
import type { ActivationService } from '../../services/ActivationService.js';
import type {
  GenerateLicenseInput,
  LicenseGenerationService,
} from '../../services/LicenseGenerationService.js';
import type { MasterLicenseRecord } from '../../types.js';
import type { DashboardLogsModule } from './logs.module.js';

export class LicensesModule {
  constructor(
    private readonly licenses: LicenseGenerationService,
    private readonly activation: ActivationService,
    private readonly logs: DashboardLogsModule,
  ) {}

  async list(): Promise<MasterLicenseRecord[]> {
    return this.licenses.list();
  }

  async listByTenant(tenantId: string): Promise<MasterLicenseRecord[]> {
    return this.licenses.listByTenant(tenantId);
  }

  async generate(input: GenerateLicenseInput): Promise<MasterLicenseRecord> {
    const row = await this.licenses.generate(input);
    await this.logs.append({
      module: 'licenses',
      action: 'LICENSE_GENERATED',
      message: `Licença ${row.tier} gerada`,
      meta: { licenseId: row.id, tenantId: row.tenantId },
    });
    return row;
  }

  async activate(input: { tenantId: string; licenseId: string }) {
    const result = await this.activation.activate(input);
    await this.logs.append({
      module: 'licenses',
      action: 'LICENSE_ACTIVATED',
      message: `Licença ativada no tenant`,
      meta: { licenseId: input.licenseId, tenantId: input.tenantId },
    });
    return result;
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }
}
