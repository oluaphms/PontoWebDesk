import React from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  KeyRound,
  Banknote,
  BarChart3,
  Plus,
  PackageOpen,
  Settings2,
  type LucideIcon,
} from 'lucide-react';

const SHORTCUTS: { to: string; label: string; hint: string; icon: LucideIcon; tone: string }[] = [
  {
    to: '/master/tenants/new',
    label: 'Nova empresa',
    hint: 'Cadastro rápido',
    icon: Plus,
    tone: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  },
  {
    to: '/master/tenants',
    label: 'Empresas',
    hint: 'CRM comercial',
    icon: Building2,
    tone: 'border-indigo-500/25 bg-indigo-500/5 text-indigo-700 dark:text-indigo-300',
  },
  {
    to: '/master/licenses',
    label: 'Licenças',
    hint: 'Ativar / renovar',
    icon: KeyRound,
    tone: 'border-violet-500/25 bg-violet-500/5 text-violet-700 dark:text-violet-300',
  },
  {
    to: '/master/payments',
    label: 'Pagamentos',
    hint: 'Confirmar PIX',
    icon: Banknote,
    tone: 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300',
  },
  {
    to: '/master/finance',
    label: 'Relatórios',
    hint: 'Receita e exportação',
    icon: BarChart3,
    tone: 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  },
  {
    to: '/master/updates',
    label: 'Atualizações',
    hint: 'Versões',
    icon: PackageOpen,
    tone: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  },
  {
    to: '/master/settings',
    label: 'Configurações',
    hint: 'Dia a dia',
    icon: Settings2,
    tone: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  },
];

export function MasterQuickShortcuts({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7'}`}
    >
      {SHORTCUTS.map((s) => {
        const Icon = s.icon;
        return (
          <Link
            key={s.to}
            to={s.to}
            className={`group flex items-center gap-2.5 rounded-2xl border px-3 py-3 transition hover:-translate-y-0.5 hover:shadow-md ${s.tone}`}
          >
            <span className="rounded-xl border border-current/10 bg-surface/80 p-2 dark:bg-black/20">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">
                {s.label}
              </span>
              <span className="block truncate text-[11px] text-foreground-muted">{s.hint}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
