// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  COMPANY_LICENSE_STATUSES,
  companyStatusLabel,
  isCompanyLicenseCycleStatus,
  isCompanyStatusBlocking,
  normalizeCompanyStatusWire,
  toCompanyStatusCanonical,
} from './companyLicenseStatus.js';

describe('Fase 6.1 — CompanyLicenseStatus', () => {
  it('define os 5 status comerciais', () => {
    expect([...COMPANY_LICENSE_STATUSES]).toEqual([
      'ACTIVE',
      'TRIAL',
      'SUSPENDED',
      'BLOCKED',
      'CANCELLED',
    ]);
  });

  it('normaliza UPPER e lower para wire', () => {
    expect(normalizeCompanyStatusWire('ACTIVE')).toBe('active');
    expect(normalizeCompanyStatusWire('trial')).toBe('trial');
    expect(normalizeCompanyStatusWire('Suspended')).toBe('suspended');
    expect(normalizeCompanyStatusWire('BLOCKED')).toBe('blocked');
    expect(normalizeCompanyStatusWire('CANCELLED')).toBe('cancelled');
    expect(normalizeCompanyStatusWire('DRAFT')).toBe('draft');
    expect(normalizeCompanyStatusWire('nope')).toBeNull();
  });

  it('converte wire → canônico', () => {
    expect(toCompanyStatusCanonical('active')).toBe('ACTIVE');
    expect(toCompanyStatusCanonical('TRIAL')).toBe('TRIAL');
  });

  it('identifica status bloqueantes', () => {
    expect(isCompanyStatusBlocking('SUSPENDED')).toBe(true);
    expect(isCompanyStatusBlocking('blocked')).toBe(true);
    expect(isCompanyStatusBlocking('CANCELLED')).toBe(true);
    expect(isCompanyStatusBlocking('ACTIVE')).toBe(false);
    expect(isCompanyStatusBlocking('TRIAL')).toBe(false);
    expect(isCompanyStatusBlocking('draft')).toBe(false);
  });

  it('ciclo comercial exclui draft', () => {
    expect(isCompanyLicenseCycleStatus('ACTIVE')).toBe(true);
    expect(isCompanyLicenseCycleStatus('draft')).toBe(false);
  });

  it('label canônico', () => {
    expect(companyStatusLabel('active')).toBe('ACTIVE');
    expect(companyStatusLabel('trial')).toBe('TRIAL');
  });
});
