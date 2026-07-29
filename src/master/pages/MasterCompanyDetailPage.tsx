import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { MasterIntelligentOnboarding } from '../components/MasterIntelligentOnboarding';
import { MasterSubscriptionFinancePanel } from '../components/MasterSubscriptionFinancePanel';
import { MasterSubscriptionNotificationPreferences } from '../components/MasterSubscriptionNotificationPreferences';
import {
  AutomationPipeline,
  CommercialPipeline,
  CommercialSummaryCard,
  CRMPanel,
  CustomerHealthPanel,
  LicensePanel,
  QuickActionsPanel,
  SubscriptionPanel,
  TechnicalLogsPanel,
  TechnicalProvisionPanel,
  UnifiedTimeline,
  useMasterCompanyDetail,
} from '../components/companyDetail';

/**
 * Orquestrador leve do Centro de Operações Comerciais.
 * Busca (via hook), loading, permissões, ações e distribuição de props.
 */
export function MasterCompanyDetailPage() {
  const { companyId = '' } = useParams<{ companyId: string }>();
  const d = useMasterCompanyDetail(companyId);

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/master/tenants"
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Empresas
        </Link>
      </div>

      {d.loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando detalhes…</p>
      )}
      {d.error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {d.error}
        </p>
      )}

      {!d.loading && d.row && (
        <>
          <CommercialSummaryCard
            row={d.row}
            lastAccessAt={d.crmLite?.lastAccessAt}
            contactName={d.crmLite?.contactName}
          />

          {d.canMutate && d.quickActionsData && (
            <QuickActionsPanel
              data={d.quickActionsData}
              actions={d.quickActionsHandlers}
            />
          )}

          {d.canMutate && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <CommercialPipeline
                row={d.row}
                journey={d.journey}
                automation={d.automation}
                crm={d.crmLite}
              />
              <AutomationPipeline
                automation={d.automation}
                automationBusy={d.automationBusy}
                onConfirmPayment={d.onConfirmPayment}
                onRetryAutomation={d.onRetryAutomation}
                inviteResolved={
                  d.journey?.firstAccessStatus === 'accepted' ||
                  Boolean(d.journey?.firstLoginAt)
                }
              />
            </div>
          )}

          {d.canMutate && d.journey && (
            <MasterIntelligentOnboarding
              companyId={companyId}
              journey={d.journey}
              automation={d.automation}
              company={d.row}
              crm={d.crmLite}
              showTimelines={false}
            />
          )}

          {d.canMutate && <UnifiedTimeline items={d.unifiedTimeline} />}

          {d.canMutate && d.journey && (
            <TechnicalProvisionPanel row={d.row} journey={d.journey} />
          )}

          <LicensePanel row={d.row} />

          {d.canMutate && d.subscriptionData && (
            <SubscriptionPanel
              data={d.subscriptionData}
              actions={d.subscriptionActions}
            />
          )}

          {d.canMutate && d.planSubscription && (
            <>
              <MasterSubscriptionFinancePanel
                companyId={companyId}
                defaultAmountCents={d.planSubscription.priceCents}
                canWrite={d.canManageFinance}
              />
              <MasterSubscriptionNotificationPreferences
                companyId={companyId}
                canWrite={d.canManageFinance}
              />
            </>
          )}

          <CustomerHealthPanel row={d.row} lastAccessAt={d.crmLite?.lastAccessAt} />

          {d.canMutate && (
            <CRMPanel
              tenantId={d.row.id}
              seedName={d.row.empresa}
              seedContact={d.row.administrador}
              seedEmail={d.row.administradorEmail}
              seedPlan={d.row.plano}
            />
          )}

          {d.canMutate && (
            <TechnicalLogsPanel
              row={d.row}
              journey={d.journey}
              automation={d.automation}
            />
          )}
        </>
      )}
    </div>
  );
}
