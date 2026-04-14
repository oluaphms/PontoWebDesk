import React, { useEffect, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  BarChart3,
  Briefcase,
  Building2,
  Calculator,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  HelpCircle,
  LayoutGrid,
  List,
  Package,
  RefreshCw,
  Scale,
  ShieldAlert,
  Tag,
  TrendingUp,
  UserCircle2,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import { prefetchPortalRoute } from '../../routes/routeChunks';

const READ = '/admin/reports/read';

type NavItem = {
  label: string;
  to?: string;
  description?: string;
  soon?: boolean;
  icon: React.ComponentType<{ className?: string }>;
};

type Section = { title: string; items: NavItem[] };

const AdminReports: React.FC = () => {
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'ChronoDigital | Relatórios';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  const sections: Section[] = useMemo(
    () => [
      {
        title: 'Relatórios',
        items: [
          {
            label: 'Cálculos',
            to: `${READ}/calculos`,
            description: 'Hub de folha, arquivamento e colunas de cálculo',
            icon: Calculator,
          },
          {
            label: 'Ponto Diário',
            to: `${READ}/ponto-diario`,
            description: 'Abre a visão de leitura do ponto diário',
            icon: CalendarDays,
          },
          {
            label: 'Geração de Arquivos Fiscais',
            to: `${READ}/geracao-arquivos-fiscais`,
            description: 'Acesso à geração / leitura fiscal',
            icon: FileSpreadsheet,
          },
          {
            label: 'Funcionários',
            to: `${READ}/funcionarios`,
            description: 'Listagem somente leitura',
            icon: Users,
          },
          {
            label: 'Distribuição dos Horários',
            to: `${READ}/distribuicao-horarios`,
            description: 'Escolha horários ou escalas, listagem ou gráfico',
            icon: LayoutGrid,
          },
          {
            label: 'Listagem de Horários',
            to: `${READ}/listagem-horarios`,
            description: 'Relatório em tabela (como o impresso legado)',
            icon: List,
          },
          {
            label: 'Escalas Cíclicas',
            to: `${READ}/escalas-ciclicas`,
            description: 'Leitura das escalas cíclicas cadastradas',
            icon: RefreshCw,
          },
        ],
      },
      {
        title: 'Ocorrências',
        items: [
          {
            label: 'Absenteísmo',
            to: `${READ}/absenteismo`,
            description: 'Leitura dos registros de ausência',
            icon: UserCircle2,
          },
          {
            label: 'Batidas rejeitadas',
            to: `${READ}/batidas-rejeitadas`,
            description: 'Abre o relatório de segurança / antifraude',
            icon: ShieldAlert,
          },
          {
            label: 'Funções',
            to: `${READ}/funcoes`,
            description: 'Cargos cadastrados (somente leitura)',
            icon: Briefcase,
          },
          {
            label: 'Inconsistências',
            to: `${READ}/inconsistencias`,
            description: 'Relatório analítico de inconsistências',
            icon: AlertTriangle,
          },
          {
            label: 'Afastamentos',
            to: `${READ}/afastamentos`,
            description: 'Atalho para a análise de ausências',
            icon: CalendarClock,
          },
        ],
      },
      {
        title: 'Quadro de Horários',
        items: [
          {
            label: 'Números Provisórios',
            to: `${READ}/numeros-provisorios`,
            description: 'Em desenvolvimento (leitura)',
            icon: Package,
          },
          {
            label: 'Histórico de Horários',
            to: `${READ}/historico-horarios`,
            description: 'Vínculos colaborador × horário × escala',
            icon: Clock,
          },
          {
            label: 'Histórico de Centro de Custos',
            to: `${READ}/historico-centro-custos`,
            description: 'Estruturas / centros de custo',
            icon: Building2,
          },
        ],
      },
      {
        title: 'Outros',
        items: [
          {
            label: 'Etiquetas',
            to: `${READ}/etiquetas`,
            description: 'Em desenvolvimento (leitura)',
            icon: Tag,
          },
          {
            label: 'Solicitações Web',
            to: '/admin/requests',
            description: 'Pedidos e aprovações',
            icon: ClipboardList,
          },
          {
            label: 'Janela Ajuda',
            to: '/admin/ajuda',
            description: 'Manual e suporte',
            icon: HelpCircle,
          },
        ],
      },
    ],
    [],
  );

  const analyticalReports = useMemo(
    () => [
      {
        id: 'journey',
        title: 'Relatório de Jornada',
        description: 'O funcionário cumpriu a jornada?',
        icon: Clock,
        color: 'from-blue-500 to-blue-600',
        path: '/admin/reports/work-hours',
        badge: 'Essencial',
      },
      {
        id: 'overtime',
        title: 'Relatório de Horas Extras',
        description: 'Quanto foi trabalhado além da jornada?',
        icon: TrendingUp,
        color: 'from-orange-500 to-orange-600',
        path: '/admin/reports/overtime',
        badge: 'Essencial',
      },
      {
        id: 'inconsistency',
        title: 'Relatório de Inconsistências',
        description: 'O que está errado no ponto?',
        icon: AlertTriangle,
        color: 'from-red-500 to-red-600',
        path: '/admin/reports/inconsistencies',
        badge: 'Importante',
      },
      {
        id: 'bankHours',
        title: 'Relatório de Banco de Horas',
        description: 'Qual o saldo de cada funcionário?',
        icon: Scale,
        color: 'from-purple-500 to-purple-600',
        path: '/admin/reports/bank-hours',
        badge: 'Importante',
      },
      {
        id: 'security',
        title: 'Relatório de Segurança (Antifraude)',
        description: 'Existe comportamento suspeito?',
        icon: ShieldAlert,
        color: 'from-red-600 to-red-700',
        path: '/admin/reports/security',
        badge: 'Diferencial',
      },
      {
        id: 'workedHours',
        title: 'Relatório de Horas Trabalhadas',
        description: 'Quanto cada funcionário trabalhou?',
        icon: BarChart3,
        color: 'from-green-500 to-green-600',
        path: '/admin/reports/work-hours',
        badge: 'Essencial',
      },
    ],
    [],
  );

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const indexShortcutCount = sections.reduce((acc, s) => acc + s.items.filter((i) => i.to && !i.soon).length, 0);
  const analyticalPathCount = new Set(analyticalReports.map((r) => r.path)).size;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Relatórios"
        subtitle="Índice de relatórios e telas correlatas (modelo ERP). Use os atalhos analíticos abaixo para PDF/Excel."
        icon={<BarChart3 className="w-5 h-5" />}
      />

      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 pb-2">
              {section.title}
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                const inner = (
                  <>
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-slate-900 dark:text-white leading-snug">{item.label}</span>
                        {item.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{item.description}</p>
                        )}
                      </div>
                      {!item.soon && item.to && (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" aria-hidden />
                      )}
                    </div>
                  </>
                );

                if (item.soon || !item.to) {
                  return (
                    <li
                      key={item.label}
                      className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-4 py-3 opacity-75"
                    >
                      {inner}
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2 font-medium">Em breve</p>
                    </li>
                  );
                }

                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onFocus={() => prefetchPortalRoute(item.to!)}
                      onMouseEnter={() => prefetchPortalRoute(item.to!)}
                      className="block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-4 py-3 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all"
                    >
                      {inner}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

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
          Os relatórios analíticos respondem perguntas sobre jornada e ponto; o índice acima reúne também telas de cálculo, ocorrências e cadastros usados no dia a dia do RH.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Atalhos no índice</div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{indexShortcutCount}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Telas do menu ERP</div>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Rotas analíticas</div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{analyticalPathCount}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Destinos únicos (cards)</div>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Formatos de exportação</div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">2</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">PDF + Excel (onde disponível)</div>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Em breve</div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white">2</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Números provisórios · Etiquetas</div>
        </div>
      </div>
    </div>
  );
};

export default AdminReports;
