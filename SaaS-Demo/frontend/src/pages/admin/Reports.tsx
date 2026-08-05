import React, { useEffect, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Scale,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import { prefetchPortalRoute } from '../../routes/routeChunks';

const AdminReports: React.FC = () => {
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'PontoWebDesk | Relatórios';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  const analyticalReports = useMemo(
    () => [
      {
        id: 'inconsistency',
        title: 'Inconsistências',
        description: 'Erros e faltas no ponto',
        icon: AlertTriangle,
        color: 'from-red-500 to-red-600',
        path: '/admin/reports/inconsistencies',
        badge: 'Essencial',
      },
      {
        id: 'journey',
        title: 'Jornada',
        description: 'Cumprimento da jornada',
        icon: Clock,
        color: 'from-blue-500 to-blue-600',
        path: '/admin/reports/work-hours',
        badge: 'Essencial',
      },
      {
        id: 'overtime',
        title: 'Horas Extras',
        description: 'Excedentes da jornada',
        icon: TrendingUp,
        color: 'from-orange-500 to-orange-600',
        path: '/admin/reports/overtime',
        badge: 'Importante',
      },
      {
        id: 'bankHours',
        title: 'Banco de Horas',
        description: 'Saldo por funcionário',
        icon: Scale,
        color: 'from-purple-500 to-purple-600',
        path: '/admin/reports/bank-hours',
        badge: 'Importante',
      },
      {
        id: 'security',
        title: 'Segurança (Antifraude)',
        description: 'Sinais de fraude',
        icon: ShieldAlert,
        color: 'from-red-600 to-red-700',
        path: '/admin/reports/security',
        badge: 'Avançado',
      },
    ],
    [],
  );

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Relatórios"
        subtitle="Relatórios analíticos para auditoria de jornada, ponto e segurança."
        icon={<BarChart3 className="w-5 h-5" />}
        helpSlug="relatorios"
      />

      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 pb-2">
          Relatórios analíticos
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {analyticalReports.map((report) => {
            const Icon = report.icon;
            return (
              <Link
                key={report.id}
                to={report.path}
                onMouseEnter={() => prefetchPortalRoute(report.path)}
                onFocus={() => prefetchPortalRoute(report.path)}
                className="group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 hover:shadow-lg"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${report.color} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
                <div className="relative p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className={`p-3 rounded-xl bg-gradient-to-br ${report.color} text-white`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className={`px-2 py-1 text-xs font-bold rounded-full bg-gradient-to-r ${report.color} text-white`}>
                      {report.badge}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-slate-700 dark:group-hover:text-slate-100 transition-colors">
                      {report.title}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{report.description}</p>
                  </div>
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
                      Acessar relatório →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-6">
        <h3 className="font-bold text-blue-900 dark:text-blue-100 mb-2">Dica</h3>
        <p className="text-sm text-blue-800 dark:text-blue-200">
          Para ver batidas, localização GPS e fotos de ponto por colaborador, use o{' '}
          <Link to="/admin/timesheet" className="font-semibold underline hover:no-underline">
            Espelho de Ponto
          </Link>
          . Os relatórios analíticos consolidam indicadores para decisão de RH.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Relatórios disponíveis</div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{analyticalReports.length}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Analíticos com exportação</div>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Formatos de exportação</div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">2</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">PDF + Excel (onde disponível)</div>
        </div>
      </div>
    </div>
  );
};

export default AdminReports;
