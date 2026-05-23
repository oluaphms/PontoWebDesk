import { flushAll } from './syncEngine';
import { getSettings } from './settingsService';
import { getEmployeesByCompany } from './employee.service';

async function syncEmployees(companyId?: string): Promise<void> {
  if (!companyId) return;
  await getEmployeesByCompany(companyId);
}

async function syncSettings(): Promise<void> {
  await getSettings();
}

export async function bootstrapCloudSync(companyId?: string): Promise<void> {
  await flushAll();
  await syncEmployees(companyId);
  await syncSettings();
}

