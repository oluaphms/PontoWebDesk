import { i18n } from '../../lib/i18n';
import type { User } from '../../types';

export interface MenuItemConfig {
  nameKey: string;
  icon: string;
  route: string;
}

/** Menu do administrador: rotas /admin/* (alinhado com AdminSidebar) */
export const adminMenuItems: MenuItemConfig[] = [
  { nameKey: 'menu.dashboard', icon: 'dashboard', route: '/admin/dashboard' },
  { nameKey: 'menu.employees', icon: 'group', route: '/admin/employees' },
  { nameKey: 'menu.departments', icon: 'business_center', route: '/admin/departments' },
  { nameKey: 'menu.cargos', icon: 'work', route: '/admin/job-titles' },
  { nameKey: 'menu.espelhoPonto', icon: 'event_note', route: '/admin/timesheet' },
  { nameKey: 'menu.monitoramento', icon: 'insights', route: '/admin/monitoring' },
  { nameKey: 'menu.escalas', icon: 'calendar_today', route: '/admin/schedules' },
  { nameKey: 'menu.horarios', icon: 'schedule', route: '/admin/shifts' },
  { nameKey: 'menu.empresa', icon: 'business', route: '/admin/company' },
  { nameKey: 'menu.reports', icon: 'data_usage', route: '/admin/reports' },
  { nameKey: 'menu.settings', icon: 'settings', route: '/admin/settings' },
];

/** Menu do funcionário: rotas /employee/* (alinhado com EmployeeSidebar) */
export const employeeMenuItems: MenuItemConfig[] = [
  { nameKey: 'menu.dashboard', icon: 'dashboard', route: '/employee/dashboard' },
  { nameKey: 'menu.registrarPonto', icon: 'touch_app', route: '/employee/clock' },
  { nameKey: 'menu.espelhoPonto', icon: 'event_note', route: '/employee/timesheet' },
  { nameKey: 'menu.timeBalance', icon: 'scale', route: '/employee/time-balance' },
  { nameKey: 'menu.perfil', icon: 'person', route: '/employee/profile' },
  { nameKey: 'menu.settings', icon: 'settings', route: '/employee/settings' },
];

/** Retorna os itens do menu conforme o papel do usuário */
export function getMenuItemsForUser(user: User): MenuItemConfig[] {
  const isAdmin = user.role === 'admin' || user.role === 'hr';
  return isAdmin ? adminMenuItems : employeeMenuItems;
}

export function getMenuItemName(item: MenuItemConfig): string {
  return i18n.t(item.nameKey);
}
