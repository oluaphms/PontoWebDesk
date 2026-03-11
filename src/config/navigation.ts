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
} from 'lucide-react';

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
}

/** Navegação admin: rotas /admin/* */
export const adminNavigation: NavItem[] = [
  { name: 'Dashboard', path: '/admin/dashboard', icon: Home },
  { name: 'Funcionários', path: '/admin/employees', icon: Users },
  { name: 'Departamentos', path: '/admin/departments', icon: Building2 },
  { name: 'Cargos', path: '/admin/job-titles', icon: Briefcase },
  { name: 'Espelho de Ponto', path: '/admin/timesheet', icon: Clock },
  { name: 'Escalas', path: '/admin/schedules', icon: Calendar },
  { name: 'Horários', path: '/admin/shifts', icon: Clock },
  { name: 'Jornada de Trabalho', path: '/admin/time-attendance', icon: CalendarClock },
  { name: 'Ajustes de Ponto', path: '/admin/adjustments', icon: Clock12 },
  { name: 'Ausências', path: '/admin/absences', icon: CircleOff },
  { name: 'Solicitações', path: '/admin/requests', icon: ClipboardList },
  { name: 'Monitoramento', path: '/admin/monitoring', icon: Activity },
  { name: 'Relatórios', path: '/admin/reports', icon: BarChart3 },
  { name: 'Empresa', path: '/admin/company', icon: Building },
  { name: 'Configurações', path: '/admin/settings', icon: Settings },
];

/** Navegação funcionário: rotas /employee/* */
export const employeeNavigation: NavItem[] = [
  { name: 'Dashboard', path: '/employee/dashboard', icon: Home },
  { name: 'Registrar Ponto', path: '/employee/clock', icon: Clock },
  { name: 'Espelho de Ponto', path: '/employee/timesheet', icon: Clock },
  { name: 'Mapa em tempo real', path: '/employee/monitoring', icon: MapPin },
  { name: 'Banco de Horas', path: '/employee/time-balance', icon: Scale },
  { name: 'Perfil', path: '/employee/profile', icon: User },
  { name: 'Configurações', path: '/employee/settings', icon: Settings },
];

/** BottomNav: 4 itens fixos + "Mais". Paths que ficam nos botões principais. */
const ADMIN_BOTTOM_PRIMARY = ['/admin/dashboard', '/admin/employees', '/admin/timesheet', '/admin/schedules'];
const EMPLOYEE_BOTTOM_PRIMARY = ['/employee/dashboard', '/employee/clock', '/employee/timesheet', '/employee/monitoring'];

/** Retorna itens de navegação conforme o papel (admin/hr = admin, senão employee) */
export function getNavigationForRole(role: string): NavItem[] {
  return role === 'admin' || role === 'hr' ? adminNavigation : employeeNavigation;
}

/** Primeiros 4 itens para a barra inferior (Dashboard, Funcionários, Ponto, Escalas ou equivalente) */
export function getBottomNavPrimaryItems(role: string): NavItem[] {
  const all = getNavigationForRole(role);
  const paths = role === 'admin' || role === 'hr' ? ADMIN_BOTTOM_PRIMARY : EMPLOYEE_BOTTOM_PRIMARY;
  const primary = paths.map((path) => all.find((item) => item.path === path)).filter(Boolean) as NavItem[];
  return primary.length > 0 ? primary : all.slice(0, 4);
}

/** Itens que vão no drawer "Mais" no mobile (demais páginas) */
export function getMoreMenuItems(role: string): NavItem[] {
  const all = getNavigationForRole(role);
  const primaryPaths = role === 'admin' || role === 'hr' ? ADMIN_BOTTOM_PRIMARY : EMPLOYEE_BOTTOM_PRIMARY;
  return all.filter((item) => !primaryPaths.includes(item.path));
}
