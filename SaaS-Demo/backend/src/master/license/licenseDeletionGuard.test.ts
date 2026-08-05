// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const queryMaster = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: {
    queryMaster: (...args: unknown[]) => queryMaster(...args),
    queryTrustedBootstrap: vi.fn(),
  },
}));

import {
  isLicenseIntentionallyDeleted,
  markLicenseIntentionallyDeleted,
  clearLicenseIntentionallyDeleted,
} from './licenseDeletionGuard.js';

describe('licenseDeletionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marca tombstone e limpa license_id no onboarding', async () => {
    queryMaster.mockResolvedValue({ rowCount: 1, rows: [] });
    await markLicenseIntentionallyDeleted('tn_1', 'lic_1');
    expect(queryMaster).toHaveBeenCalled();
    const sql = String(queryMaster.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('license_id = null');
    expect(sql).toContain('wizard_meta');
  });

  it('detecta tombstone em wizard_meta', async () => {
    queryMaster.mockResolvedValue({
      rows: [{ wizard_meta: { licenseIntentionallyDeleted: true } }],
    });
    expect(await isLicenseIntentionallyDeleted('tn_1')).toBe(true);
  });

  it('clear remove chaves do tombstone', async () => {
    queryMaster.mockResolvedValue({ rowCount: 1, rows: [] });
    await clearLicenseIntentionallyDeleted('tn_1');
    const sql = String(queryMaster.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain("licenseIntentionallyDeleted");
  });
});
