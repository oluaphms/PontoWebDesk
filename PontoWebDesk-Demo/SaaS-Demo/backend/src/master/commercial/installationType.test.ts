// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assertInstallationPlanCycle,
  installationTypeFromMode,
  modeFromInstallationType,
  planCycleFromInstallationType,
  requiredPlanCycleForInstallation,
} from './installationType.js';

describe('Fase 6.6 — installationType', () => {
  it('mapeia mode legado para tipo de instalação', () => {
    expect(installationTypeFromMode('LOCAL')).toBe('ON_PREMISE');
    expect(installationTypeFromMode('SAAS')).toBe('SAAS_WEB');
    expect(installationTypeFromMode('HYBRID')).toBe('SAAS_WEB');
  });

  it('define ciclo obrigatório por tipo', () => {
    expect(requiredPlanCycleForInstallation('SAAS_WEB')).toBe('MONTHLY');
    expect(requiredPlanCycleForInstallation('ON_PREMISE')).toBe('ANNUAL');
    expect(planCycleFromInstallationType('SAAS_WEB')).toBe('MONTHLY');
    expect(modeFromInstallationType('ON_PREMISE')).toBe('LOCAL');
  });

  it('rejeita combinações inválidas', () => {
    expect(() => assertInstallationPlanCycle('SAAS_WEB', 'ANNUAL')).toThrow(/mensal/i);
    expect(() => assertInstallationPlanCycle('ON_PREMISE', 'MONTHLY')).toThrow(/anual/i);
    expect(() => assertInstallationPlanCycle('SAAS_WEB', 'MONTHLY')).not.toThrow();
    expect(() => assertInstallationPlanCycle('ON_PREMISE', 'ANNUAL')).not.toThrow();
  });
});
