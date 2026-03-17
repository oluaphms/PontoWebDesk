import type { LucideIcon } from 'lucide-react';
import {
  Home,
  Users,
  Building2,
  Briefcase,
  Clock,
  Clock12,
  Calendar,
  Activity,
  BarChart3,
  Building,
  Settings,
  MapPin,
  Scale,
  User,
  CalendarClock,
  ClipboardList,
  CircleOff,
  ShieldCheck,
  ShieldAlert,
  Upload,
} from 'lucide-react';

export interface NavItem {
  name: string;
  /** Chave i18n para exibir o nome no idioma atual (ex: menu.dashboard) */
  nameKey: string;
  path: string;
  icon: LucideIcon;
}

/** Navegação admin: rotas /admin/* */
export const adminNavigation: NavItem[] = [
  { name: 'Dashboard', nameKey: 'menu.dashboard', path: '/admin/dashboard', icon: Home },
  { name: 'Funcionários', nameKey: 'menu.employees', path: '/admin/employees', icon: Users },
  { name: 'Importar Funcionários', nameKey: 'menu.importEmployees', path: '/admin/import-employees', icon: Upload },
  { name: 'Departamentos', nameKey: 'menu.departments', path: '/admin/departments', icon: Building2 },
  { name: 'Cargos', nameKey: 'menu.cargos', path: '/admin/job-titles', icon: Briefcase },
  { name: 'Espelho de Ponto', nameKey: 'menu.espelhoPonto', path: '/admin/timesheet', icon: Clock },
  { name: 'Escalas', nameKey: 'menu.escalas', path: '/admin/schedules', icon: Calendar },
  { name: 'Horários', nameKey: 'menu.horarios', path: '/admin/shifts', icon: Clock },
  { name: 'Jornada de Trabalho', nameKey: 'menu.timeAttendance', path: '/admin/time-attendance', icon: CalendarClock },
  { name: 'Ajustes de Ponto', nameKey: 'menu.adjustments', path: '/admin/adjustments', icon: Clock12 },
  { name: 'Banco de Horas', nameKey: 'menu.timeBalance', path: '/admin/bank-hours', icon: Scale },
  { name: 'Ausências', nameKey: 'menu.absences', path: '/admin/absences', icon: CircleOff },
  { name: 'Solicitações', nameKey: 'menu.requests', path: '/admin/requests', icon: ClipboardList },
  { name: 'Monitoramento', nameKey: 'menu.monitoramento', path: '/admin/monitoring', icon: Activity },
  { name: 'Relatórios', nameKey: 'menu.reports', path: '/admin/reports', icon: BarChart3 },
  { name: 'Relógios REP', nameKey: 'menu.repDevices', path: '/admin/rep-devices', icon: Clock },
  { name: 'Monitor REP', nameKey: 'menu.repMonitor', path: '/admin/rep-monitor', icon: Activity },
  { name: 'Importar AFD', nameKey: 'menu.importRep', path: '/admin/import-rep', icon: Upload },
  { name: 'Fiscalização REP-P', nameKey: 'menu.fiscalizacao', path: '/admin/fiscalizacao', icon: ShieldCheck },
  { name: 'Segurança e Antifraude', nameKey: 'menu.securityAntifraud', path: '/admin/security', icon: ShieldAlert },
  { name: 'Empresa', nameKey: 'menu.empresa', path: '/admin/company', icon: Building },
  { name: 'Configurações', nameKey: 'menu.settings', path: '/admin/settings', icon: Settings },
];

/** Navegação funcionário: rotas /employee/* */
export const employeeNavigation: NavItem[] = [
  { name: 'Dashboard', nameKey: 'menu.dashboard', path: '/employee/dashboard', icon: Home },
  { name: 'Registrar Ponto', nameKey: 'menu.registrarPonto', path: '/employee/clock', icon: Clock },
  { name: 'Meu Espelho de Ponto', nameKey: 'menu.espelhoPonto', path: '/employee/timesheet', icon: Clock },
  { name: 'Minhas Solicitações', nameKey: 'menu.myRequests', path: '/employee/requests', icon: ClipboardList },
  { name: 'Minhas Ausências', nameKey: 'menu.myAbsences', path: '/employee/absences', icon: CircleOff },
  { name: 'Mapa em tempo real', nameKey: 'menu.realTimeMap', path: '/employee/monitoring', icon: MapPin },
  { name: 'Banco de Horas', nameKey: 'menu.timeBalance', path: '/employee/time-balance', icon: Scale },
  { name: 'Meu Perfil', nameKey: 'menu.perfil', path: '/employee/profile', icon: User },
  { name: 'Configurações', nameKey: 'menu.settings', path: '/employee/settings', icon: Settings },
];

/** BottomNav: 4 itens fixos + "Mais". Paths que ficam nos botões principais. */
const ADMIN_BOTTOM_PRIMARY = ['/admin/dashboard', '/admin/employees', '/admin/timesheet', '/admin/schedules'];
const EMPLOYEE_BOTTOM_PRIMARY = ['/employee/dashboard', '/employee/clock', '/employee/timesheet', '/employee/monitoring'];

/**
 * Retorna itens de navegação conforme o papel e o path atual (RBAC).
 * Em /employee/* sempre retorna menu do funcionário (evita mostrar menu admin por engano).
 */
export function getNavigationForRole(role: string, currentPath?: string): NavItem[] {
  if (currentPath?.startsWith('/employee')) {
    return employeeNavigation;
  }
  if (currentPath?.startsWith('/admin')) {
    return role === 'admin' || role === 'hr' ? adminNavigation : employeeNavigation;
  }
  return role === 'admin' || role === 'hr' ? adminNavigation : employeeNavigation;
}

/** Primeiros 4 itens para a barra inferior (Dashboard, Funcionários, Ponto, Escalas ou equivalente) */
export function getBottomNavPrimaryItems(role: string, currentPath?: string): NavItem[] {
  const all = getNavigationForRole(role, currentPath);
  const paths = role === 'admin' || role === 'hr' ? ADMIN_BOTTOM_PRIMARY : EMPLOYEE_BOTTOM_PRIMARY;
  const primary = paths.map((path) => all.find((item) => item.path === path)).filter(Boolean) as NavItem[];
  return primary.length > 0 ? primary : all.slice(0, 4);
}

/** Itens que vão no drawer "Mais" no mobile. Admin: lista completa. Funcionário: itens não fixos na bottom bar. */
export function getMoreMenuItems(role: string, currentPath?: string): NavItem[] {
  const all = getNavigationForRole(role, currentPath);
  if (role === 'admin' || role === 'hr') {
    return all;
  }
  const primaryPaths = EMPLOYEE_BOTTOM_PRIMARY;
  return all.filter((item) => !primaryPaths.includes(item.path));
}
