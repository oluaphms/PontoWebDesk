import React, { memo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Activity,
  Calendar,
  Clock,
  Building,
  Building2,
  Briefcase,
  FileBarChart,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  MapPin,
  Heart,
  CalendarClock,
  CalendarPlus,
  UserX,
  CalendarRange,
  FileText,
  FileCheck,
  CircleOff,
  HelpCircle,
  Timer,
  Upload,
} from 'lucide-react';
import type { User } from '../../types';

const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;

const ADMIN_ITEMS = [
  { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Funcionários', path: '/admin/employees', icon: Users },
  { label: 'Departamentos', path: '/admin/departments', icon: Building2 },
  { label: 'Cargos (Funções)', path: '/admin/job-titles', icon: Briefcase },
  { label: 'Estruturas', path: '/admin/estruturas', icon: GitBranch },
  { label: 'Cidades', path: '/admin/cidades', icon: MapPin },
  { label: 'Estados Civis', path: '/admin/estados-civis', icon: Heart },
  { label: 'Eventos', path: '/admin/eventos', icon: CalendarClock },
  { label: 'Motivos Demissão', path: '/admin/motivo-demissao', icon: UserX },
  { label: 'Feriados', path: '/admin/feriados', icon: CalendarRange },
  { label: 'Justificativas', path: '/admin/justificativas', icon: FileCheck },
  { label: 'Espelho de Ponto', path: '/admin/timesheet', icon: CalendarDays },
  { label: 'Cartão Ponto', path: '/admin/cartao-ponto', icon: FileText },
  { label: 'Cartão Ponto (Somente Leitura)', path: '/admin/cartao-ponto-leitura', icon: FileText },
  { label: 'Lançamento de Eventos', path: '/admin/lancamento-eventos', icon: CalendarPlus },
  { label: 'Ausências (Relatório)', path: '/admin/ausencias', icon: CircleOff },
  { label: 'Arquivar Cálculos', path: '/admin/arquivar-calculos', icon: CalendarDays },
  { label: 'Colunas Mix', path: '/admin/colunas-mix', icon: CalendarDays },
  { label: 'Ponto Diário', path: '/admin/ponto-diario', icon: CalendarDays },
  { label: 'Ponto Diário (Somente Leitura)', path: '/admin/ponto-diario-leitura', icon: CalendarDays },
  { label: 'Arquivos Fiscais', path: '/admin/arquivos-fiscais', icon: FileText },
  { label: 'Relógios REP', path: '/admin/rep-devices', icon: Timer },
  { label: 'Monitor REP', path: '/admin/rep-monitor', icon: Activity },
  { label: 'Importar AFD', path: '/admin/import-rep', icon: Upload },
  { label: 'Monitoramento', path: '/admin/monitoring', icon: Activity },
  { label: 'Escalas', path: '/admin/schedules', icon: Calendar },
  { label: 'Horários', path: '/admin/shifts', icon: Clock },
  { label: 'Empresa', path: '/admin/company', icon: Building },
  { label: 'Relatórios', path: '/admin/reports', icon: FileBarChart },
  { label: 'Ajuda', path: '/admin/ajuda', icon: HelpCircle },
  { label: 'Configurações', path: '/admin/settings', icon: Settings },
];

export interface AdminSidebarProps {
  user: User;
  onLogout: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const AdminSidebar: React.FC<AdminSidebarProps> = ({ user, onLogout, onCollapsedChange }) => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleToggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      onCollapsedChange?.(next);
      return next;
    });
  }, [onCollapsedChange]);

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 z-30 hidden lg:flex flex-col bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200/80 dark:border-slate-800/80 transition-[width] duration-300 ease-in-out overflow-hidden"
      style={{
        width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
        boxShadow: '4px 0 24px rgba(0,0,0,0.06)',
      }}
      aria-label="Menu administrativo"
    >
      <div className="flex flex-col flex-1 min-h-0 p-3">
        <div
          className={`flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-2'} pb-4 border-b border-slate-100 dark:border-slate-800`}
        >
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight block truncate">
                SmartPonto
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Admin</span>
            </div>
          )}
        </div>

        <nav className="mt-4 flex-1 overflow-y-auto min-h-0 flex flex-col gap-1 py-2">
          {ADMIN_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={`
                  group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all
                  ${collapsed ? 'justify-center px-2' : ''}
                  ${isActive
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                  }
                `}
                title={collapsed ? item.label : undefined}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full opacity-90" />
                )}
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div
          className={`pt-4 mt-auto border-t border-slate-100 dark:border-slate-800 ${collapsed ? 'px-0' : 'px-2'}`}
        >
          <div
            className={`rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-3 ${collapsed ? 'flex flex-col items-center' : ''}`}
          >
            {!collapsed && (
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold border-2 border-white dark:border-slate-700 shrink-0">
                  {user.nome.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.nome}</p>
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase truncate">
                    {user.cargo}
                  </p>
                </div>
              </div>
            )}
            {collapsed && (
              <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold border-2 border-white dark:border-slate-700 mx-auto mb-2">
                {user.nome.charAt(0)}
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              className={`w-full flex items-center justify-center gap-2 py-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all text-xs font-bold ${collapsed ? 'px-0' : ''}`}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Sair</span>}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className="mt-2 flex items-center justify-center w-full py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>
    </aside>
  );
};

export default memo(AdminSidebar);
