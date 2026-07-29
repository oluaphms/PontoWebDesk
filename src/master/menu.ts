import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Building2,
  KeyRound,
  Banknote,
  BarChart3,
  Server,
  Flag,
  HardDrive,
  RefreshCw,
  ScrollText,
  HeartPulse,
  Settings2,
  ShieldCheck,
  Activity,
  Database,
  PackageOpen,
  UsersRound,
  Boxes,
} from 'lucide-react';

export type MasterMenuItem = {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  description?: string;
  /** Permissão mínima para exibir o atalho (backend continua autoritativo). */
  permission?: string;
  /** Separador visual acima do item (FASE 31). */
  separatorBefore?: boolean;
};

export type MasterMenuGroup = {
  id: 'principal' | 'configuracoes' | 'monitoramento' | 'ocultos';
  label: string;
  description: string;
  items: readonly MasterMenuItem[];
};

/**
 * Menu lateral visível (FASE 31 — operação comercial manual).
 * Demais itens permanecem em MASTER_HIDDEN_MENU / rotas — só saem da navegação.
 */
export const MASTER_DAILY_MENU: readonly MasterMenuItem[] = [
  {
    id: 'dashboard',
    label: 'Página inicial',
    to: '/master',
    icon: LayoutDashboard,
    description: 'Indicadores comerciais',
    permission: 'dashboard:read',
  },
  {
    id: 'empresas',
    label: 'Empresas',
    to: '/master/tenants',
    icon: Building2,
    description: 'CRM comercial',
    permission: 'tenants:read',
  },
  {
    id: 'licencas',
    label: 'Licenças',
    to: '/master/licenses',
    icon: KeyRound,
    description: 'Central de Licenciamento',
    permission: 'licenses:read',
  },
  {
    id: 'planos',
    label: 'Planos',
    to: '/master/plans',
    icon: Boxes,
    description: 'Planos mensais e anuais',
    permission: 'subscriptions:read',
  },
  {
    id: 'assinaturas',
    label: 'Assinaturas',
    to: '/master/subscriptions',
    icon: KeyRound,
    description: 'Planos por empresa',
    permission: 'subscriptions:read',
  },
  {
    id: 'pagamentos',
    label: 'Pagamentos',
    to: '/master/payments',
    icon: Banknote,
    description: 'Pagamentos',
    permission: 'payments:read',
  },
  {
    id: 'relatorios',
    label: 'Relatórios',
    to: '/master/finance',
    icon: BarChart3,
    description: 'Relatórios comerciais',
    permission: 'payments:read',
  },
  {
    id: 'usuarios-master',
    label: 'Usuários Master',
    to: '/master/users',
    icon: UsersRound,
    description: 'Contas, perfis e bloqueios',
    permission: 'users:read',
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    to: '/master/settings',
    icon: Settings2,
    description: 'Opções administrativas do dia a dia',
    permission: 'admin:write',
  },
  {
    id: 'atualizacoes',
    label: 'Atualizações',
    to: '/master/updates',
    icon: PackageOpen,
    description: 'Central de Atualizações',
    permission: 'deployments:read',
    separatorBefore: true,
  },
] as const;

/** Itens técnicos/comerciais avançados — ocultos da sidebar, rotas preservadas. */
export const MASTER_HIDDEN_MENU: readonly MasterMenuItem[] = [
  {
    id: 'seguranca',
    label: 'Segurança',
    to: '/master/security',
    icon: ShieldCheck,
    description: 'Checklist OWASP, LGPD, backup e sessão',
  },
  {
    id: 'hub',
    label: 'Central',
    to: '/master/hub',
    icon: LayoutDashboard,
    description: 'Central Master',
  },
  {
    id: 'deploy',
    label: 'Implantação',
    to: '/master/deployments',
    icon: Server,
    description: 'Gerenciador de implantação — SaaS / Local / Híbrido',
  },
  {
    id: 'flags',
    label: 'Flags de recurso',
    to: '/master/admin?section=featureFlags',
    icon: Flag,
    description: 'Flags da plataforma',
  },
  {
    id: 'storage',
    label: 'Armazenamento',
    to: '/master/admin?section=storage',
    icon: HardDrive,
    description: 'Persistência / provedor',
  },
  {
    id: 'sync',
    label: 'Sincronização',
    to: '/master/admin?section=sync',
    icon: RefreshCw,
    description: 'Sincronização híbrida / filas',
  },
  {
    id: 'health',
    label: 'Saúde',
    to: '/master/admin?section=health',
    icon: HeartPulse,
    description: 'Saúde e monitoramento',
  },
  {
    id: 'admin',
    label: 'Administração Global',
    to: '/master/admin?section=settings',
    icon: Settings2,
    description: 'Configuração global da plataforma',
  },
  {
    id: 'logs',
    label: 'Registros',
    to: '/master/admin?section=logs',
    icon: ScrollText,
    description: 'Registros Master',
  },
  {
    id: 'audit',
    label: 'Auditoria',
    to: '/master/admin?section=audit',
    icon: ShieldCheck,
    description: 'Eventos de auditoria',
  },
  {
    id: 'api-status',
    label: 'Situação da API',
    to: '/master/admin?section=apiStatus',
    icon: Activity,
    description: 'Disponibilidade da API',
  },
  {
    id: 'database-status',
    label: 'Situação do Banco',
    to: '/master/admin?section=databaseStatus',
    icon: Database,
    description: 'Persistência e armazenamento',
  },
  {
    id: 'synchronization',
    label: 'Sincronização',
    to: '/master/admin?section=synchronization',
    icon: RefreshCw,
    description: 'Filas, offline e conflitos',
  },
  {
    id: 'charges',
    label: 'Cobranças',
    to: '/master/charges',
    icon: Banknote,
    description: 'Cobranças (oculto da operação diária)',
  },
  {
    id: 'invoices',
    label: 'Faturas',
    to: '/master/invoices',
    icon: Banknote,
    description: 'Faturas (oculto da operação diária)',
  },
  {
    id: 'pix',
    label: 'Gerenciador PIX',
    to: '/master/pix',
    icon: Banknote,
    description: 'PIX automático (oculto — confirmação é manual)',
  },
  {
    id: 'subscriptions',
    label: 'Assinaturas',
    to: '/master/subscriptions',
    icon: KeyRound,
    description: 'Assinaturas (oculto da operação diária)',
  },
] as const;

/** Compat: aliases usados por títulos / hub. */
export const MASTER_SETTINGS_MENU = MASTER_HIDDEN_MENU.filter((i) =>
  ['deploy', 'flags', 'storage', 'sync', 'health', 'admin'].includes(i.id),
);

export const MASTER_MONITORING_MENU = MASTER_HIDDEN_MENU.filter((i) =>
  ['logs', 'audit', 'api-status', 'database-status', 'synchronization'].includes(i.id),
);

export const MASTER_MENU_GROUPS: readonly MasterMenuGroup[] = [
  {
    id: 'principal',
    label: 'Principal',
    description: 'Operação comercial diária',
    items: MASTER_DAILY_MENU,
  },
  {
    id: 'ocultos',
    label: 'Ocultos (URL direta)',
    description: 'Infra e módulos avançados — não aparecem no menu',
    items: MASTER_HIDDEN_MENU,
  },
] as const;

/** Lista plana (compat título / hub / deep-links). */
export const MASTER_MENU: readonly MasterMenuItem[] = [
  ...MASTER_DAILY_MENU,
  ...MASTER_HIDDEN_MENU,
] as const;

/** Escopo operacional — NÃO faz parte do Master (referência visual). */
export const OPERATIONAL_SCOPE = [
  'Admin Empresa',
  'Gestor',
  'RH',
  'Colaborador',
  'REP',
  'App',
  'Espelho',
  'Banco de Horas',
] as const;
