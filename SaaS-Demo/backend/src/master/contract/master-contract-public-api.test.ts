// @vitest-environment node
/**
 * Compatibilidade reversa do contrato público @pontowebdesk/master-contract.
 * Baseline congelada da versão anterior — remover campo/export público falha aqui.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_VALIDITY_KEYS,
} from '@pontowebdesk/master-contract';

/**
 * Contrato público da versão anterior (1.0.0).
 * Atualizar conscientemente só em mudança de contrato versionada.
 */
const PREVIOUS_PUBLIC_API = {
  packageName: '@pontowebdesk/master-contract',
  version: '1.0.0',
  valueExports: ['COMMERCIAL_VALIDITY_KEYS'] as const,
  typeExports: [
    'CommercialLicenseViewState',
    'CompanyLicenseDisplayStatus',
    'LicenseValidityPhase',
    'CompanyLicenseDto',
    'LicenseCentralRow',
    'LicenseControlRules',
    'LicenseHistoryEntry',
    'LicenseMode',
    'LicenseRuleOverrides',
    'LicenseStatus',
    'ManagedTenantDto',
    'ExecutiveChartSlice',
    'MasterExecutiveCharts',
    'MasterExecutiveRevenueBlock',
    'MasterExecutiveSummary',
    'MasterExecutiveSupportBlock',
    'MasterExecutiveUpdatesBlock',
    'MasterRecentPayment',
  ] as const,
  commercialLicenseViewStateKeys: [
    'phase',
    'displayStatus',
    'statusLabel',
    'shouldBlock',
    'reason',
    'label',
    'remainingLabel',
    'daysDelta',
    'daysRemaining',
    'daysExpired',
    'startsAtEffective',
    'expiresAt',
    'startsToday',
    'expiresToday',
  ] as const,
} as const;

const here = path.dirname(fileURLToPath(import.meta.url));
const sharedIndex = path.resolve(
  here,
  '../../../../shared/master-contract/index.ts',
);

describe('master-contract-public-api — compatibilidade reversa', () => {
  it('não remove campos/exports públicos da versão anterior', () => {
    const indexSrc = fs.readFileSync(sharedIndex, 'utf8');
    const pkg = JSON.parse(
      fs.readFileSync(
        path.resolve(here, '../../../../shared/master-contract/package.json'),
        'utf8',
      ),
    ) as { name: string; version: string };

    expect(pkg.name).toBe(PREVIOUS_PUBLIC_API.packageName);

    for (const exp of PREVIOUS_PUBLIC_API.valueExports) {
      expect(indexSrc, `export de valor ausente: ${exp}`).toMatch(
        new RegExp(`\\b${exp}\\b`),
      );
    }
    for (const exp of PREVIOUS_PUBLIC_API.typeExports) {
      expect(indexSrc, `export de tipo ausente: ${exp}`).toMatch(
        new RegExp(`\\b${exp}\\b`),
      );
    }

    // Remoção de campo público do ViewState = falha imediata.
    for (const key of PREVIOUS_PUBLIC_API.commercialLicenseViewStateKeys) {
      expect(
        COMMERCIAL_VALIDITY_KEYS.includes(key),
        `Campo público removido do contrato: ${key}`,
      ).toBe(true);
    }

    // Runtime do pacote ainda exporta as chaves anteriores.
    expect([...COMMERCIAL_VALIDITY_KEYS]).toEqual(
      expect.arrayContaining([...PREVIOUS_PUBLIC_API.commercialLicenseViewStateKeys]),
    );
  });
});
