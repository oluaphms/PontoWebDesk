import { describe, expect, it } from 'vitest';
import { deriveIntelligentOnboarding } from './deriveIntelligentOnboarding';
import type { CommercialJourney } from '../api/companiesApi';

function baseJourney(partial: Partial<CommercialJourney> = {}): CommercialJourney {
  return {
    tenantId: 't1',
    operationalCompanyId: 'op1',
    state: 'awaiting_first_login',
    customerId: 'c1',
    subscriptionId: 's1',
    licenseId: 'l1',
    adminUserId: 'a1',
    adminEmail: 'admin@ex.com',
    inviteSentAt: '2026-07-01T10:00:00.000Z',
    firstLoginAt: null,
    lastError: null,
    nextAction: 'aguardar_login',
    steps: [
      { id: 'company', label: 'Empresa', status: 'completed', detail: 'ok' },
      { id: 'plan', label: 'Plano', status: 'completed', detail: 'PRO' },
      { id: 'license', label: 'Licença', status: 'completed', detail: 'ativa' },
      { id: 'admin', label: 'Admin', status: 'completed', detail: 'enviado' },
      { id: 'first_login', label: 'Login', status: 'pending', detail: 'aguardando' },
      { id: 'activation', label: 'Ativação', status: 'pending', detail: '—' },
      { id: 'customer', label: 'Cliente', status: 'completed', detail: 'ok' },
    ],
    wizard: {
      tenantId: 't1',
      mode: 'LOCAL',
      plan: 'PRO',
      progressPercent: 70,
      currentStepIndex: 4,
      currentStepId: 'send_first_access',
      implantationStatus: 'in_progress',
      canResume: true,
      wizardSteps: [
        { id: 'register_company', index: 0, label: 'Empresa', status: 'completed', detail: 'ok' },
        { id: 'create_admin', index: 1, label: 'Admin', status: 'completed', detail: 'ok' },
        { id: 'choose_plan', index: 2, label: 'Plano', status: 'completed', detail: 'PRO' },
        { id: 'generate_license', index: 3, label: 'Licença', status: 'completed', detail: 'ok' },
        { id: 'send_first_access', index: 4, label: 'Acesso', status: 'completed', detail: 'ok' },
        { id: 'issue_agent_token', index: 5, label: 'Agent', status: 'pending', detail: '—' },
        { id: 'finalize', index: 6, label: 'Finalizar', status: 'pending', detail: '—' },
      ],
      installationId: null,
      agentTokenIssuedAt: null,
      agentSkipped: false,
      implantationCompletedAt: null,
      summary: {
        companyCreated: true,
        licenseActive: true,
        adminCreated: true,
        firstAccessSent: true,
        updaterRegistered: false,
        implantationCompleted: false,
      },
    },
    ...partial,
  };
}

describe('deriveIntelligentOnboarding', () => {
  it('monta a jornada completa e marca etapa atual no primeiro login', () => {
    const view = deriveIntelligentOnboarding({ journey: baseJourney() });
    expect(view.milestones).toHaveLength(7);
    expect(view.milestones[0]?.status).toBe('completed');
    expect(view.milestones.find((m) => m.id === 'first_login')?.status).toBe('current');
    expect(
      view.milestones.some((m) => m.label.toLowerCase().includes('funcionário') || m.label.toLowerCase().includes('batida')),
    ).toBe(false);
    expect(view.pending.some((p) => p.id === 'first_login')).toBe(true);
    expect(view.progressPercent).toBeGreaterThan(0);
    expect(view.timeline.length).toBe(7);
  });

  it('não inclui indicadores operacionais de ponto/funcionário', () => {
    const view = deriveIntelligentOnboarding({
      journey: baseJourney({
        state: 'completed',
        firstLoginAt: '2026-07-02T12:00:00.000Z',
        wizard: {
          ...baseJourney().wizard!,
          implantationStatus: 'Implantação concluída',
          implantationCompletedAt: '2026-07-02T13:00:00.000Z',
          progressPercent: 100,
          summary: {
            companyCreated: true,
            licenseActive: true,
            adminCreated: true,
            firstAccessSent: true,
            updaterRegistered: true,
            implantationCompleted: true,
          },
        },
      }),
    });
    expect(view.milestones.some((m) => m.label.includes('funcionário'))).toBe(false);
    expect(view.milestones.some((m) => m.label.includes('batida'))).toBe(false);
    expect(view.milestones.find((m) => m.id === 'operational')?.status).toBe('completed');
  });
});
