import type { CompanyLicense } from '../types.js';
import type { LicenseManagerStore } from '../ports/LicenseManagerStore.js';

export class InMemoryLicenseManagerStore implements LicenseManagerStore {
  readonly persistence = 'memory' as const;
  private readonly byId = new Map<string, CompanyLicense>();

  async list(): Promise<CompanyLicense[]> {
    return [...this.byId.values()]
      .map((r) => ({ ...r, rules: { ...r.rules }, ruleOverrides: { ...r.ruleOverrides } }))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async get(id: string): Promise<CompanyLicense | null> {
    const row = this.byId.get(id);
    return row
      ? { ...row, rules: { ...row.rules }, ruleOverrides: { ...row.ruleOverrides } }
      : null;
  }

  async getByTenantId(tenantId: string): Promise<CompanyLicense | null> {
    const id = String(tenantId || '').trim();
    const digits = id.replace(/\D/g, '');
    for (const row of this.byId.values()) {
      const sameId = row.tenantId === id;
      const sameDigits =
        digits.length >= 8 && String(row.tenantId || '').replace(/\D/g, '') === digits;
      if (sameId || sameDigits) {
        return { ...row, rules: { ...row.rules }, ruleOverrides: { ...row.ruleOverrides } };
      }
    }
    return null;
  }

  async save(row: CompanyLicense): Promise<CompanyLicense> {
    const next = {
      ...row,
      rules: { ...row.rules },
      ruleOverrides: { ...row.ruleOverrides },
    };
    this.byId.set(row.id, next);
    return { ...next, rules: { ...next.rules }, ruleOverrides: { ...next.ruleOverrides } };
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }

  async clear(): Promise<void> {
    this.byId.clear();
  }
}
