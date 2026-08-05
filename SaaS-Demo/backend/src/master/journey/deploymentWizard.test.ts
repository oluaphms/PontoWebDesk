// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  composeWizardSteps,
  isWizardStepDone,
  validateWizardStep,
  type WizardEvidence,
} from './deploymentWizard.js';

function baseEvidence(partial: Partial<WizardEvidence> = {}): WizardEvidence {
  return {
    hasTenant: true,
    hasCompanyName: true,
    hasOperationalCompany: false,
    hasAdminName: true,
    hasAdminEmail: true,
    hasAdminUser: false,
    hasPlan: true,
    hasSubscription: false,
    hasLicense: false,
    licenseActive: false,
    inviteSent: false,
    agentRegistered: false,
    agentSkipped: false,
    implantationCompleted: false,
    failed: false,
    mode: 'LOCAL',
    ...partial,
  };
}

describe('deploymentWizard (FASE 28)', () => {
  it('barra de progresso e etapa atual', () => {
    const composed = composeWizardSteps(
      baseEvidence({
        hasOperationalCompany: true,
        hasAdminUser: true,
        hasSubscription: true,
        hasLicense: true,
        licenseActive: true,
      }),
    );
    expect(composed.progressPercent).toBeGreaterThan(0);
    expect(composed.implantationStatus).toBe('in_progress');
    expect(composed.canResume).toBe(true);
    expect(composed.steps[0].status).toBe('completed');
    expect(composed.steps.find((s) => s.status === 'current')?.id).toBe('send_first_access');
  });

  it('valida ordem: não finaliza sem etapas anteriores', () => {
    const check = validateWizardStep('finalize', baseEvidence());
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe('STEPS_INCOMPLETE');
  });

  it('Implantação concluída quando finalize marcado', () => {
    const evidence = baseEvidence({
      hasOperationalCompany: true,
      hasAdminUser: true,
      hasSubscription: true,
      hasLicense: true,
      licenseActive: true,
      inviteSent: true,
      agentSkipped: true,
      implantationCompleted: true,
    });
    expect(isWizardStepDone('finalize', evidence)).toBe(true);
    const composed = composeWizardSteps(evidence);
    expect(composed.implantationStatus).toBe('Implantação concluída');
    expect(composed.progressPercent).toBe(100);
  });

  it('SaaS pode dispensar Update Agent', () => {
    const evidence = baseEvidence({
      mode: 'SAAS',
      hasOperationalCompany: true,
      hasAdminUser: true,
      hasSubscription: true,
      hasLicense: true,
      licenseActive: true,
      inviteSent: true,
      agentSkipped: true,
    });
    expect(isWizardStepDone('issue_agent_token', evidence)).toBe(true);
  });
});
