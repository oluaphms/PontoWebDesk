/**
 * Garante que o frontend Master não reimplementa a regra de vigência.
 * A fonte única é o backend (evaluateCommercialLicense / buildCommercialLicenseViewState).
 */
import { describe, expect, it } from 'vitest';
import * as licenseValidityUtils from './licenseValidity';

describe('frontend licenseValidity — apenas tipagem/render helpers', () => {
  it('não exporta funções de decisão de vigência', () => {
    expect('evaluateCommercialLicense' in licenseValidityUtils).toBe(false);
    expect('evaluateLicenseValidityView' in licenseValidityUtils).toBe(false);
    expect('evaluateLicenseValidity' in licenseValidityUtils).toBe(false);
    expect('toBrazilDateOnly' in licenseValidityUtils).toBe(false);
    expect('buildCommercialLicenseViewState' in licenseValidityUtils).toBe(false);
    expect(typeof licenseValidityUtils.toDateInputValue).toBe('function');
  });

  it('toDateInputValue só formata string YYYY-MM-DD (sem regra comercial)', () => {
    expect(licenseValidityUtils.toDateInputValue('2026-08-31T12:00:00.000Z')).toBe(
      '2026-08-31',
    );
    expect(licenseValidityUtils.toDateInputValue('2026-08-31')).toBe('2026-08-31');
    expect(licenseValidityUtils.toDateInputValue(null)).toBe('');
  });
});
