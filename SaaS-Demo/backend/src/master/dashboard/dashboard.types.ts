/**
 * Tipos do Master Dashboard (backend).
 * MasterExecutiveSummary e blocos executivos: fonte única @pontowebdesk/master-contract.
 */

export type {
  ExecutiveChartSlice,
  MasterExecutiveCharts,
  MasterExecutiveRevenueBlock,
  MasterExecutiveSummary,
  MasterExecutiveSupportBlock,
  MasterExecutiveUpdatesBlock,
  MasterRecentPayment,
} from '@pontowebdesk/master-contract';

export type MasterDashboardModuleId =
  | 'customers'
  | 'subscriptions'
  | 'licenses'
  | 'charges'
  | 'payments'
  | 'plans'
  | 'gateway'
  | 'logs';

export type MasterDashboardModuleInfo = {
  id: MasterDashboardModuleId;
  label: string;
  description: string;
};

export const MASTER_DASHBOARD_MODULES: readonly MasterDashboardModuleInfo[] = [
  { id: 'customers', label: 'Clientes', description: 'Cadastro e listagem de clientes Master.' },
  { id: 'subscriptions', label: 'Assinaturas', description: 'Ciclo de vida de assinaturas / planos.' },
  { id: 'licenses', label: 'Licenças', description: 'Geração e ativação de licenças.' },
  { id: 'charges', label: 'Cobranças', description: 'Cobranças do BillingEngine e faturas.' },
  { id: 'payments', label: 'Pagamentos', description: 'PIX e registros de PaymentProvider.' },
  { id: 'plans', label: 'Planos', description: 'Catálogo LicensePlan e features.' },
  { id: 'gateway', label: 'Gateway', description: 'Provedores de pagamento (Asaas/Stripe/PagSeguro).' },
  { id: 'logs', label: 'Logs', description: 'Trilha de auditoria do Painel Master.' },
] as const;

export type DashboardLogLevel = 'info' | 'warn' | 'error';

export type DashboardLogEntry = {
  id: string;
  module: MasterDashboardModuleId | 'system';
  level: DashboardLogLevel;
  action: string;
  message: string;
  at: string;
  meta?: Readonly<Record<string, unknown>>;
};

export type MasterDashboardSummary = {
  modules: readonly MasterDashboardModuleInfo[];
  counts: {
    customers: number;
    tenants: number;
    subscriptions: number;
    licenses: number;
    invoices: number;
    charges: number;
    payments: number;
    plans: number;
    gateways: number;
    logs: number;
  };
};
