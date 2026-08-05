/**
 * Anexa licenseValidity derivado exclusivamente de buildCommercialLicenseViewState.
 * Usado pelos endpoints Master (tenants, etc.) para uma única fonte de verdade.
 */
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type { CompanyLicense } from '../licenseManager/types.js';
import {
  buildCommercialLicenseViewState,
  type CommercialLicenseViewState,
} from './licenseValidity.js';

export type WithLicenseValidity<T> = T & {
  licenseValidity: CommercialLicenseViewState;
};

export function ensureCompanyLicenseValidity(license: CompanyLicense): CompanyLicense {
  if (license.validity) return license;
  return {
    ...license,
    validity: buildCommercialLicenseViewState({
      startsAt: license.startsAt,
      expiresAt: license.expiresAt,
      licenseStatus: license.status,
    }),
  };
}

export async function enrichTenantsWithLicenseValidity(
  tenants: ManagedTenant[],
): Promise<WithLicenseValidity<ManagedTenant>[]> {
  let licenses: CompanyLicense[] = [];
  try {
    licenses = (await MasterPlatformService.getLicenseManager().list()).map(
      ensureCompanyLicenseValidity,
    );
  } catch {
    licenses = [];
  }
  const byTenant = new Map(licenses.map((l) => [l.tenantId, l]));

  return tenants.map((t) => {
    const lic = byTenant.get(t.id);
    const licenseValidity = buildCommercialLicenseViewState({
      startsAt: lic?.startsAt ?? null,
      expiresAt: lic?.expiresAt ?? t.license?.expiresAt ?? null,
      tenantStatus: t.status,
      licenseStatus: lic?.status ?? null,
    });
    return { ...t, licenseValidity };
  });
}

export async function enrichTenantWithLicenseValidity(
  tenant: ManagedTenant,
): Promise<WithLicenseValidity<ManagedTenant>> {
  const [row] = await enrichTenantsWithLicenseValidity([tenant]);
  return row;
}
