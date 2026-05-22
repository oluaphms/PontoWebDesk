import { isCloudEnabled } from './cloudService';
import { flushAll } from './syncEngine';
import { getSettings } from './settingsService';
import { getUsersByCompany } from './employee.service';

async function syncEmployees(companyId?: string): Promise<void> {
  // Cache local é reidratado pelo próprio serviço.
  if (!companyId) return;
  await getUsersByCompany(companyId);
}

async function syncSettings(): Promise<void> {
  await getSettings();
}

export async function bootstrapCloudSync(companyId?: string): Promise<void> {
  if (!isCloudEnabled()) return;
  await flushAll();
  await syncEmployees(companyId);
  await syncSettings();
}

