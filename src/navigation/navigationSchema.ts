/**
 * Schema de navegação hierárquica por grupos.
 * Compatível com React Router, i18n (nameKey) e role-based (admin/hr vs employee).
 */

export type NavRole = 'admin' | 'hr' | 'employee';

export interface NavigationItemSchema {
  name: string;
  /** Chave i18n (ex: menu.dashboard) */
  nameKey: string;
  path: string;
  /** Roles que podem ver este item. admin e hr usam rotas /admin/*, employee usa /employee/* */
  roles: NavRole[];
}

export interface NavigationGroupSchema {
  label: string;
  /** Chave i18n para o label do grupo (ex: nav.groupDashboard) */
  labelKey: string;
  icon: string;
  items: NavigationItemSchema[];
}

export const navigationGroups: Record<string, NavigationGroupSchema> = {
  dashboard: {
    label: 'Dashboard',
    labelKey: 'nav.groupDashboard',
    icon: 'home',
    items: [
      { name: 'Dashboard', nameKey: 'menu.dashboard', path: '/admin/dashboard', roles: ['admin', 'hr'] },
      { name: 'Dashboard', nameKey: 'menu.dashboard', path: '/employee/dashboard', roles: ['employee'] },
    ],
  },

  people: {
    label: 'Pessoas',
    labelKey: 'nav.groupPeople',
    icon: 'users',
    items: [
      { name: 'Funcionários', nameKey: 'menu.employees', path: '/admin/employees', roles: ['admin', 'hr'] },
      { name: 'Importar Funcionários', nameKey: 'menu.importEmployees', path: '/admin/import-employees', roles: ['admin', 'hr'] },
      { name: 'Departamentos', nameKey: 'menu.departments', path: '/admin/departments', roles: ['admin', 'hr'] },
      { name: 'Cargos', nameKey: 'menu.cargos', path: '/admin/job-titles', roles: ['admin', 'hr'] },
      { name: 'Estruturas', nameKey: 'menu.estruturas', path: '/admin/estruturas', roles: ['admin', 'hr'] },
    ],
  },

  time: {
    label: 'Ponto',
    labelKey: 'nav.groupTime',
    icon: 'clock',
    items: [
      { name: 'Registrar Ponto', nameKey: 'menu.registrarPonto', path: '/employee/clock', roles: ['employee'] },
      { name: 'Espelho de Ponto', nameKey: 'menu.espelhoPonto', path: '/admin/timesheet', roles: ['admin', 'hr'] },
      { name: 'Meu Espelho de Ponto', nameKey: 'menu.espelhoPonto', path: '/employee/timesheet', roles: ['employee'] },
      { name: 'Jornada de Trabalho', nameKey: 'menu.timeAttendance', path: '/admin/time-attendance', roles: ['admin', 'hr'] },
      { name: 'Escalas', nameKey: 'menu.escalas', path: '/admin/schedules', roles: ['admin', 'hr'] },
      { name: 'Horários', nameKey: 'menu.horarios', path: '/admin/shifts', roles: ['admin', 'hr'] },
      { name: 'Ajustes de Ponto', nameKey: 'menu.adjustments', path: '/admin/adjustments', roles: ['admin', 'hr'] },
      { name: 'Banco de Horas', nameKey: 'menu.timeBalance', path: '/admin/bank-hours', roles: ['admin', 'hr'] },
      { name: 'Banco de Horas', nameKey: 'menu.timeBalance', path: '/employee/time-balance', roles: ['employee'] },
    ],
  },

  management: {
    label: 'Gestão',
    labelKey: 'nav.groupManagement',
    icon: 'bar-chart',
    items: [
      { name: 'Ausências', nameKey: 'menu.absences', path: '/admin/absences', roles: ['admin', 'hr'] },
      { name: 'Solicitações', nameKey: 'menu.requests', path: '/admin/requests', roles: ['admin', 'hr'] },
      { name: 'Minhas Solicitações', nameKey: 'menu.myRequests', path: '/employee/requests', roles: ['employee'] },
      { name: 'Minhas Ausências', nameKey: 'menu.myAbsences', path: '/employee/absences', roles: ['employee'] },
      { name: 'Monitoramento', nameKey: 'menu.monitoramento', path: '/admin/monitoring', roles: ['admin', 'hr'] },
      { name: 'Mapa em tempo real', nameKey: 'menu.realTimeMap', path: '/employee/monitoring', roles: ['employee'] },
      { name: 'Relatórios', nameKey: 'menu.reports', path: '/admin/reports', roles: ['admin', 'hr'] },
    ],
  },

  smart: {
    label: 'Smart',
    labelKey: 'nav.groupSmart',
    icon: 'zap',
    items: [
      { name: 'Relógios REP', nameKey: 'menu.repDevices', path: '/admin/rep-devices', roles: ['admin', 'hr'] },
      { name: 'Monitor REP', nameKey: 'menu.repMonitor', path: '/admin/rep-monitor', roles: ['admin', 'hr'] },
      { name: 'Importar AFD', nameKey: 'menu.importRep', path: '/admin/import-rep', roles: ['admin', 'hr'] },
      { name: 'Fiscalização REP-P', nameKey: 'menu.fiscalizacao', path: '/admin/fiscalizacao', roles: ['admin', 'hr'] },
      { name: 'Segurança e Antifraude', nameKey: 'menu.securityAntifraud', path: '/admin/security', roles: ['admin', 'hr'] },
      { name: 'Empresa', nameKey: 'menu.empresa', path: '/admin/company', roles: ['admin', 'hr'] },
      { name: 'Configurações', nameKey: 'menu.settings', path: '/admin/settings', roles: ['admin', 'hr'] },
      { name: 'Ajuda', nameKey: 'menu.ajuda', path: '/admin/ajuda', roles: ['admin', 'hr'] },
      { name: 'Configurações', nameKey: 'menu.settings', path: '/employee/settings', roles: ['employee'] },
      { name: 'Meu Perfil', nameKey: 'menu.perfil', path: '/employee/profile', roles: ['employee'] },
    ],
  },
};

export type ResolvedRole = 'admin' | 'employee';

/**
 * Normaliza role do usuário para admin (admin/hr) ou employee.
 */
export function resolveRole(role: string): ResolvedRole {
  return role === 'admin' || role === 'hr' ? 'admin' : 'employee';
}

/**
 * Filtra itens de um grupo pelo role do usuário.
 */
export function filterGroupItemsByRole<T extends { roles: NavRole[] }>(
  items: T[],
  role: string
): T[] {
  const resolved: ResolvedRole = resolveRole(role);
  return items.filter((item) =>
    item.roles.some((r) => (r === 'admin' || r === 'hr' ? resolved === 'admin' : resolved === 'employee'))
  );
}

/**
 * Retorna grupos de navegação com itens filtrados pelo role.
 */
export function getNavigationGroupsByRole(role: string): Record<string, NavigationGroupSchema> {
  const result: Record<string, NavigationGroupSchema> = {};
  for (const [key, group] of Object.entries(navigationGroups)) {
    const filteredItems = filterGroupItemsByRole(group.items, role);
    if (filteredItems.length > 0) {
      result[key] = { ...group, items: filteredItems };
    }
  }
  return result;
}

/**
 * Lista plana de todos os itens de navegação para o role (para Command Palette).
 */
export function getFlatNavigationByRole(role: string): NavigationItemSchema[] {
  const groups = getNavigationGroupsByRole(role);
  return Object.values(groups).flatMap((g) => g.items);
}
