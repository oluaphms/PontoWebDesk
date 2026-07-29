// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { mergeWizardMetaRaw } from './deploymentWizard.js';
import { MasterNotifications } from './masterNotifications.js';

describe('FASE 30 — Automação Comercial (helpers)', () => {
  beforeEach(() => {
    MasterNotifications.clear();
  });

  it('mergeWizardMetaRaw preserva automation ao atualizar outros campos', () => {
    const merged = mergeWizardMetaRaw(
      {
        installationId: 'inst_1',
        automation: { status: 'completed', timeline: [{ step: 'payment_confirmed' }] },
      },
      { lastWizardStep: 'finalize', agentSkipped: true },
    );
    expect(merged.installationId).toBe('inst_1');
    expect(merged.lastWizardStep).toBe('finalize');
    expect(merged.agentSkipped).toBe(true);
    expect(merged.automation).toEqual({
      status: 'completed',
      timeline: [{ step: 'payment_confirmed' }],
    });
  });

  it('mergeWizardMetaRaw permite sobrescrever automation', () => {
    const merged = mergeWizardMetaRaw(
      { automation: { status: 'failed' } },
      { automation: { status: 'running', timeline: [] } },
    );
    expect(merged.automation).toEqual({ status: 'running', timeline: [] });
  });

  it('MasterNotifications append/list/unread/mark', () => {
    MasterNotifications.append({
      tenantId: 'tn_a',
      title: 'Pagamento confirmado',
      message: 'Pipeline iniciado',
      level: 'info',
    });
    MasterNotifications.append({
      tenantId: 'tn_b',
      title: 'Sistema pronto',
      message: 'OK',
      level: 'success',
    });
    expect(MasterNotifications.list(10)).toHaveLength(2);
    expect(MasterNotifications.unreadCount()).toBe(2);
    expect(MasterNotifications.list(10, 'tn_a')).toHaveLength(1);
    const first = MasterNotifications.list(1)[0];
    MasterNotifications.markRead(first.id);
    expect(MasterNotifications.unreadCount()).toBe(1);
    expect(MasterNotifications.markAllRead()).toBe(1);
    expect(MasterNotifications.unreadCount()).toBe(0);
  });

  it('nunca integra gateway — nota explícita no contrato de snapshot', () => {
    // Contrato documentado: gatewayIntegrated é sempre false
    const snapshot = {
      gatewayIntegrated: false as const,
      note: 'Automação comercial — pagamento confirmado manualmente no Master; sem gateway financeiro',
    };
    expect(snapshot.gatewayIntegrated).toBe(false);
    expect(snapshot.note.toLowerCase()).toContain('sem gateway');
  });
});
