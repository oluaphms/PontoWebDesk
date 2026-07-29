import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { MASTER_DAILY_MENU } from '../menu';
import { hasMasterPermission } from '../api/masterApi';

/**
 * Hub de compatibilidade: mantém a rota existente e reflete a navegação atual.
 */
export function MasterHubPage() {
  return (
    <div className="space-y-8 max-w-5xl">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
          PontoWebDesk Plataforma
        </p>
        <h2 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-white tracking-tight">
          Navegação Master
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
          Atalhos para a administração comercial da plataforma.
        </p>
      </header>

      <HubCard
        title="Administração comercial"
        subtitle="Clientes, licenças, pagamentos, relatórios e versões"
        links={MASTER_DAILY_MENU.filter(
          (item) => !item.permission || hasMasterPermission(item.permission),
        )}
      />
    </div>
  );
}

function HubCard({
  title,
  subtitle,
  links,
}: {
  title: string;
  subtitle: string;
  links: ReadonlyArray<{
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface shadow-card p-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{subtitle}</p>
      </div>
      <ul className="space-y-1">
        {links.map((link) => {
          const LIcon = link.icon;
          return (
            <li key={`${link.to}-${link.label}`}>
              <Link
                to={link.to}
                className="group flex items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-300 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
              >
                <span className="inline-flex items-center gap-2">
                  <LIcon className="w-3.5 h-3.5 text-indigo-600 group-hover:text-indigo-700 dark:text-indigo-300 dark:group-hover:text-indigo-300" />
                  {link.label}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-700 dark:text-slate-400 dark:group-hover:text-indigo-300" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
