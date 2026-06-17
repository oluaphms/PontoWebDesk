import { flushAll } from './syncEngine';
import { getSettings } from './settingsService';
import { getEmployeesByCompany } from './employee.service';
import { isApiConfigured } from '../config/env';
import { getToken } from './authToken';

async function syncEmployees(companyId?: string): Promise<void> {
  if (!companyId) return;
  await getEmployeesByCompany(companyId);
}

async function syncSettings(companyId?: string): Promise<void> {
  if (isApiConfigured() && !getToken()) return;
  await getSettings(companyId);
}

export async function bootstrapCloudSync(companyId?: string): Promise<void> {
  await flushAll();
  await syncEmployees(companyId);
  await syncSettings(companyId);
}

