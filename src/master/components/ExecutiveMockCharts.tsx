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
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import {
  MOCK_MODE_MIX,
  MOCK_REVENUE_SERIES,
  MOCK_USAGE_SERIES,
} from '../mock/executiveCharts.mock';

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
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-4 [--chart-border:#e2e8f0] [--chart-grid:#e2e8f0] [--chart-muted:#64748b] [--chart-text:#0f172a] [--chart-tooltip-bg:#ffffff]  dark:[--chart-border:#1e293b] dark:[--chart-grid:#1e293b] dark:[--chart-muted:#94a3b8] dark:[--chart-text:#e2e8f0] dark:[--chart-tooltip-bg:#0f172a]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-900 dark:text-white">{title}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <span className="shrink-0 rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
          mock
        </span>
      </div>
      <div className="h-56 w-full">{children}</div>
    </div>
  );
}

/** Gráficos do Dashboard Comercial — recharts (mesmo stack do projeto). */
export function ExecutiveMockCharts() {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Tendências comerciais
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartShell title="Receita mensal" subtitle="Últimos 6 meses — ilustrativo">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...MOCK_REVENUE_SERIES]}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
              <YAxis tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [
                  `R$ ${Number(value).toLocaleString('pt-BR')}`,
                  'Receita',
                ]}
              />
              <Bar dataKey="receita" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell title="Mix SaaS · Local · Híbrido" subtitle="Distribuição relativa — ilustrativo">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[...MOCK_MODE_MIX]}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={78}
                paddingAngle={3}
              >
                {MOCK_MODE_MIX.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`${value}%`, 'Share']}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: 'var(--chart-muted)' }}
                formatter={(value) => <span style={{ color: 'var(--chart-text)' }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartShell>

        <div className="lg:col-span-2">
          <ChartShell title="Assinaturas e atividade" subtitle="Série semanal — ilustrativo">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={[...MOCK_USAGE_SERIES]}>
                <defs>
                  <linearGradient id="masterAtivo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="masterPunches" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="day" tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
                <YAxis tick={{ fill: 'var(--chart-muted)', fontSize: 11 }} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value) => <span style={{ color: 'var(--chart-text)' }}>{value}</span>}
                />
                <Area
                  type="monotone"
                  dataKey="ativo"
                  name="Contas ativas"
                  stroke="#6366f1"
                  fill="url(#masterAtivo)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="punches"
                  name="Cobranças"
                  stroke="#8b5cf6"
                  fill="url(#masterPunches)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartShell>
        </div>
      </div>
    </section>
  );
}
