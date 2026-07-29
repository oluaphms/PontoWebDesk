import type { CommercialLicenseViewState } from './commercialLicenseViewState.js';

export type MasterRecentPayment = {
  id: string;
  label: string;
  amountCents: number;
  status: string;
  method: string;
  at: string;
};

export type ExecutiveChartSlice = {
  name: string;
  value: number;
};

export type MasterExecutiveUpdatesBlock = {
  current: number;
  outdated: number;
  unknown: number;
  failedRequests: number;
  available: boolean;
};

export type MasterExecutiveRevenueBlock = {
  /** MRR contratado (assinaturas ACTIVE/TRIAL). */
  contractedMrrCents: number | null;
  /**
   * Compat: NÃO é MRR.
   * Representa "A receber" = soma de cobranças OPEN/PENDING/OVERDUE.
   */
  predictedMrrCents: number | null;
  overdueClients: number | null;
  /** Caixa efetivamente recebido no mês civil. */
  monthReceiptsCents: number | null;
  overdueCents: number | null;
  available: boolean;
};

export type MasterExecutiveSupportBlock = {
  awaitingFirstLogin: number | null;
  outdatedInstallations: number | null;
  syncConflicts: number | null;
  syncPending: number | null;
  offlinePending: number | null;
};

export type MasterExecutiveCharts = {
  companiesByStatus: ExecutiveChartSlice[];
  modeMix: ExecutiveChartSlice[];
  updatesByStatus: ExecutiveChartSlice[];
  licensesByStatus: ExecutiveChartSlice[];
};

/** Resumo executivo do dashboard / summary Master. */
export type MasterExecutiveSummary = {
  companies: number;
  companiesActive: number;
  companiesBlocked: number;
  companiesTrial: number;
  users: number;
  subscriptions: number;
  licenses: number;
  licensesActive: number;
  licensesExpired: number;
  licensesTrial: number;
  licensesScheduled: number;
  licensesExpiring7d: number;
  licensesExpiring30d: number;
  revenueCents: number;
  monthlyRevenueCents: number;
  annualRevenueCents: number;
  pixPending: number;
  renewalsDue: number;
  licensesExpiring: number;
  licenseValidities: Array<{
    licenseId: string;
    tenantId: string;
    validity: CommercialLicenseViewState;
  }>;
  currency: 'BRL';
  gateway: number;
  gatewayActive: string | null;
  modeSaas: number;
  modeLocal: number;
  modeHybrid: number;
  recentPayments: MasterRecentPayment[];
  updates: MasterExecutiveUpdatesBlock;
  revenue: MasterExecutiveRevenueBlock;
  support: MasterExecutiveSupportBlock;
  charts: MasterExecutiveCharts;
  source: 'in_memory' | 'composed';
  persistence?: 'postgres' | 'in_memory';
};
