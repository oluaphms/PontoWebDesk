import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { MasterExecutiveSummary } from '../api/masterApi';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];

const tooltipStyle = {
  backgroundColor: 'var(--chart-tooltip-bg)',
  border: '1px solid var(--chart-border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--chart-text)',
};

function ChartShell({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-4 [--chart-border:#e2e8f0] [--chart-grid:#e2e8f0] [--chart-muted:#64748b] [--chart-text:#0f172a] [--chart-tooltip-bg:#ffffff]  dark:[--chart-border:#1e293b] dark:[--chart-grid:#1e293b] dark:[--chart-muted:#94a3b8] dark:[--chart-text:#e2e8f0] dark:[--chart-tooltip-bg:#0f172a]">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {empty ? (
        <div className="flex h-56 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
          Aguardando dados.
        </div>
      ) : (
        <div className="h-56 w-full">{children}</div>
      )}
    </div>
  );
}

/** Gráficos com séries reais do executive — sem mocks. */
export function ExecutiveRealCharts({ executive }: { executive: MasterExecutiveSummary }) {
  const modeMix = executive.charts?.modeMix ?? [];
  const companies = executive.charts?.companiesByStatus ?? [];
  const updates = executive.charts?.updatesByStatus ?? [];
  const licenses = executive.charts?.licensesByStatus ?? [];

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Visão gráfica
      </h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartShell
          title="Modo de implantação"
          subtitle="Distribuição SaaS / Local / Híbrido"
          empty={modeMix.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={modeMix} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                {modeMix.map((_, i) => (
                  <Cell key={modeMix[i].name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell
          title="Empresas por situação"
          subtitle="Contagem real do gerenciador de tenants"
          empty={companies.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={companies}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill="#4f46e5" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell
          title="Atualizações"
          subtitle="Instalações e falhas do Control Plane"
          empty={!executive.updates?.available || updates.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={updates}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell
          title="Licenças"
          subtitle="Situação do gerenciador de licenças"
          empty={licenses.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={licenses} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                {licenses.map((_, i) => (
                  <Cell key={licenses[i].name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartShell>
      </div>
    </section>
  );
}
