import { useCallback, useEffect, useMemo, useState } from 'react';
import { MasterTenantsService } from '../../services/masterTenantsService';
import {
  fetchCommercialJourney,
  prepareCommercialFirstAccessPassword,
  provisionCommercialJourney,
  resendCommercialFirstAccess,
  fetchCommercialAutomation,
  confirmCommercialPayment,
  retryCommercialAutomation,
  type CommercialJourney,
  type CommercialAutomation,
  type MasterCompanyAction,
} from '../../api/companiesApi';
import { type MasterCompanyRow } from '../../types/company';
import { fetchTenantCrm, type CrmProfile } from '../../api/crmApi';
import {
  isFavorite,
  toggleFavorite,
  touchRecentClient,
  touchRecentImplant,
} from '../../ux/masterUxStorage';
import { hasMasterPermission } from '../../api/masterApi';
import {
  assignCompanyPlan,
  cancelCompanyPlan,
  changeCompanyPlan,
  fetchCompanyPlanSubscription,
  fetchSaasPlans,
  type CompanyPlanSubscription,
  type SaasPlan,
} from '../../api/plansApi';
import { parseInstallationType, requiredPlanCycleForInstallation } from '../../commercial/installationType';
import { deriveIntelligentOnboarding } from '../../ux/deriveIntelligentOnboarding';
import { buildUnifiedTimeline } from './buildUnifiedTimeline';

/**
 * Fonte única de dados/ações da tela de detalhe Master.
 * Componentes presentacionais não fazem fetch.
 */
export function useMasterCompanyDetail(companyId: string) {
  const [row, setRow] = useState<MasterCompanyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [journey, setJourney] = useState<CommercialJourney | null>(null);
  const [journeyBusy, setJourneyBusy] = useState(false);
  const [temporaryPasswordPreview, setTemporaryPasswordPreview] = useState<string | null>(null);
  const [temporaryPasswordExpiresAt, setTemporaryPasswordExpiresAt] = useState<string | null>(null);
  const [automation, setAutomation] = useState<CommercialAutomation | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [saasPlans, setSaasPlans] = useState<SaasPlan[]>([]);
  const [planSubscription, setPlanSubscription] = useState<CompanyPlanSubscription | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [crmLite, setCrmLite] = useState<Pick<
    CrmProfile,
    'lastAccessAt' | 'deploymentDate' | 'contactName' | 'email'
  > | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      let company: MasterCompanyRow | null = null;
      try {
        company = await MasterTenantsService.get(companyId);
      } catch {
        const list = await MasterTenantsService.list();
        company = list.find((c) => c.id === companyId) ?? null;
        if (!company) setError('Empresa não encontrada na API Master.');
      }
      setRow(company);
      if (company) {
        touchRecentClient(company.id, company.empresa);
        setFavorite(isFavorite(company.id));
      }
      const journeySnap =
        company?.source === 'tenant_manager'
          ? await fetchCommercialJourney(companyId)
          : null;
      setJourney(journeySnap);
      if (
        company &&
        journeySnap?.wizard?.implantationStatus === 'Implantação concluída'
      ) {
        touchRecentImplant(company.id, company.empresa);
      }
      if (company?.source === 'tenant_manager') {
        try {
          setAutomation(await fetchCommercialAutomation(companyId));
        } catch {
          setAutomation(null);
        }
        try {
          const snap = await fetchTenantCrm(companyId);
          setCrmLite({
            lastAccessAt: snap.profile.lastAccessAt,
            deploymentDate: snap.profile.deploymentDate,
            contactName: snap.profile.contactName,
            email: snap.profile.email,
          });
        } catch {
          setCrmLite(null);
        }
        try {
          const [plans, subscription] = await Promise.all([
            fetchSaasPlans(false),
            fetchCompanyPlanSubscription(companyId),
          ]);
          const installationType = parseInstallationType(company.installationType);
          const requiredCycle = requiredPlanCycleForInstallation(installationType);
          const filtered = plans.filter((p) => p.cycle === requiredCycle);
          setSaasPlans(filtered);
          setPlanSubscription(subscription);
          setSelectedPlanId(
            subscription?.planId && filtered.some((p) => p.id === subscription.planId)
              ? subscription.planId
              : filtered[0]?.id ?? '',
          );
        } catch {
          setSaasPlans([]);
          setPlanSubscription(null);
        }
      } else {
        setAutomation(null);
        setCrmLite(null);
      }
    } catch (err) {
      setRow(null);
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function runAction(action: MasterCompanyAction) {
    const labels: Record<MasterCompanyAction, string> = {
      block: 'bloquear',
      unblock: 'desbloquear',
      suspend: 'suspender',
      cancel: 'cancelar',
      activate: 'ativar',
      start_trial: 'iniciar período de teste',
    };
    if (!window.confirm(`Confirma ${labels[action]} esta empresa?`)) return;
    let reason: string | undefined;
    if (action === 'block') {
      const typed = window.prompt('Motivo do bloqueio administrativo (obrigatório):', '');
      reason = String(typed || '').trim();
      if (!reason) {
        setError('Informe o motivo do bloqueio para registrar na auditoria.');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await MasterTenantsService.action(companyId, action, reason);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao ${labels[action]}`);
    } finally {
      setBusy(false);
    }
  }

  async function runJourney(resend = false) {
    setJourneyBusy(true);
    setError(null);
    try {
      const next = resend
        ? await resendCommercialFirstAccess(companyId)
        : await provisionCommercialJourney(companyId);
      setJourney(next);
      setTemporaryPasswordPreview(null);
      setRow(await MasterTenantsService.get(companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar a jornada comercial.');
      try {
        setJourney(await fetchCommercialJourney(companyId));
      } catch {
        // Mantém o último snapshot visível.
      }
    } finally {
      setJourneyBusy(false);
    }
  }

  async function runPrepareTemporaryPassword() {
    setJourneyBusy(true);
    setError(null);
    try {
      const prepared = await prepareCommercialFirstAccessPassword(companyId);
      setJourney(prepared.journey);
      setTemporaryPasswordPreview(prepared.temporaryPassword);
      setTemporaryPasswordExpiresAt(prepared.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar senha provisória.');
    } finally {
      setJourneyBusy(false);
    }
  }

  async function runAutomation(mode: 'confirm' | 'retry' = 'confirm') {
    const msg =
      mode === 'retry'
        ? 'Retomar a automação comercial após falha?'
        : 'Confirmar pagamento MANUALMENTE e disparar a ativação automática?\n\nNão há provedor de pagamento — a confirmação é só no Master.';
    if (!window.confirm(msg)) return;
    setAutomationBusy(true);
    setError(null);
    try {
      const next =
        mode === 'retry'
          ? await retryCommercialAutomation(companyId)
          : await confirmCommercialPayment(companyId);
      setAutomation(next);
      setJourney(await fetchCommercialJourney(companyId));
      setRow(await MasterTenantsService.get(companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na automação comercial.');
      try {
        setAutomation(await fetchCommercialAutomation(companyId));
      } catch {
        // mantém snapshot
      }
    } finally {
      setAutomationBusy(false);
    }
  }

  const canMutate = row?.source === 'tenant_manager';
  const canManageSubscription = Boolean(canMutate && hasMasterPermission('subscriptions:write'));
  const canManageFinance = Boolean(canMutate && hasMasterPermission('payments:write'));

  const applySelectedPlan = useCallback(async () => {
    if (!selectedPlanId) return;
    setPlanBusy(true);
    setError(null);
    try {
      const updated = planSubscription
        ? await changeCompanyPlan(companyId, selectedPlanId)
        : await assignCompanyPlan(companyId, selectedPlanId);
      setPlanSubscription(updated);
      setSelectedPlanId(updated.planId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alterar plano da empresa.');
    } finally {
      setPlanBusy(false);
    }
  }, [companyId, planSubscription, selectedPlanId]);

  const cancelSubscription = useCallback(async () => {
    if (!window.confirm('Cancelar a assinatura atual desta empresa?')) return;
    setPlanBusy(true);
    setError(null);
    try {
      await cancelCompanyPlan(companyId);
      setPlanSubscription(null);
      setSelectedPlanId(saasPlans[0]?.id ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao cancelar assinatura.');
    } finally {
      setPlanBusy(false);
    }
  }, [companyId, saasPlans]);

  const onToggleFavorite = useCallback(() => {
    if (!row) return;
    const next = toggleFavorite(row.id, row.empresa);
    setFavorite(next.favorites.some((f) => f.id === row.id));
  }, [row]);

  const runActionCb = useCallback(
    (action: MasterCompanyAction) => {
      void runAction(action);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId],
  );

  const runPrepareTemporaryPasswordCb = useCallback(() => {
    void runPrepareTemporaryPassword();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const onResendInvite = useCallback(() => {
    void runJourney(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const onProvision = useCallback(() => {
    void runJourney(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const onConfirmPayment = useCallback(() => {
    void runAutomation('confirm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const onRetryAutomation = useCallback(() => {
    void runAutomation('retry');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const onboardingView = useMemo(
    () =>
      row && canMutate
        ? deriveIntelligentOnboarding({
            journey,
            automation,
            company: row,
            crm: crmLite,
          })
        : null,
    [row, canMutate, journey, automation, crmLite],
  );

  const unifiedTimeline = useMemo(
    () => buildUnifiedTimeline({ onboarding: onboardingView, automation }),
    [onboardingView, automation],
  );

  const quickActionsData = useMemo(
    () =>
      row
        ? {
            row,
            journey,
            busy,
            journeyBusy,
            favorite,
            temporaryPasswordPreview,
            temporaryPasswordExpiresAt,
          }
        : null,
    [
      row,
      journey,
      busy,
      journeyBusy,
      favorite,
      temporaryPasswordPreview,
      temporaryPasswordExpiresAt,
    ],
  );

  const quickActionsHandlers = useMemo(
    () => ({
      onToggleFavorite,
      onRunAction: runActionCb,
      onPrepareTemporaryPassword: runPrepareTemporaryPasswordCb,
      onResendInvite,
      onProvision,
    }),
    [onToggleFavorite, runActionCb, runPrepareTemporaryPasswordCb, onResendInvite, onProvision],
  );

  const subscriptionData = useMemo(
    () =>
      row
        ? {
            installationType: row.installationType,
            commercialPlanLabel: row.plano,
            planSubscription,
            saasPlans,
            selectedPlanId,
            planBusy,
            canManageSubscription,
          }
        : null,
    [
      row,
      planSubscription,
      saasPlans,
      selectedPlanId,
      planBusy,
      canManageSubscription,
    ],
  );

  const subscriptionActions = useMemo(
    () => ({
      onSelectedPlanIdChange: setSelectedPlanId,
      onApplySelectedPlan: () => {
        void applySelectedPlan();
      },
      onCancelSubscription: () => {
        void cancelSubscription();
      },
    }),
    [applySelectedPlan, cancelSubscription],
  );

  return {
    row,
    loading,
    error,
    busy,
    journey,
    journeyBusy,
    temporaryPasswordPreview,
    temporaryPasswordExpiresAt,
    automation,
    automationBusy,
    favorite,
    saasPlans,
    planSubscription,
    selectedPlanId,
    setSelectedPlanId,
    planBusy,
    crmLite,
    canMutate: Boolean(canMutate),
    canManageSubscription,
    canManageFinance,
    unifiedTimeline,
    quickActionsData,
    quickActionsHandlers,
    subscriptionData,
    subscriptionActions,
    onConfirmPayment,
    onRetryAutomation,
    runAction,
    runJourney,
    runPrepareTemporaryPassword,
    runAutomation,
    applySelectedPlan,
    cancelSubscription,
    onToggleFavorite,
  };
}
