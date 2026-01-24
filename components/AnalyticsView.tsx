
import React, { useState, useEffect, useMemo } from 'react';
import { PontoService } from '../services/pontoService';
import { User, CompanyKPIs, TimeRecord, LogType, Department } from '../types';
import { LoadingState, Badge } from './UI';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Users, 
  ShieldCheck, 
  Calendar,
  AlertCircle,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  BarChart3,
  LineChart,
  Filter,
  Building
} from 'lucide-react';

interface AnalyticsViewProps {
  admin: User;
}

interface DailyDistribution {
  date: string;
  [LogType.IN]: number;
  [LogType.OUT]: number;
  [LogType.BREAK]: number;
  total: number;
}

interface OvertimeDataPoint {
  day: number;
  hours: number;
  label: string;
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ admin }) => {
  const [kpis, setKpis] = useState<CompanyKPIs | null>(null);
  const [distributionData, setDistributionData] = useState<DailyDistribution[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [overtimeData, setOvertimeData] = useState<OvertimeDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedDept, setSelectedDept] = useState<string>('ALL');

  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      const [kpiData, allRecords, depts, employees] = await Promise.all([
        PontoService.getCompanyKPIs(admin.companyId),
        PontoService.loadAllRecords(),
        PontoService.getDepartments(admin.companyId),
        PontoService.getAllEmployees(admin.companyId)
      ]);

      setKpis(kpiData);
      setDepartments(depts);

      const companyRecords = allRecords.filter(r => r.companyId === admin.companyId);
      
      // 1. Process operational distribution (last 7 days)
      const last7Days: DailyDistribution[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const dayKey = date.toDateString();
        const dayRecords = companyRecords.filter(r => r.createdAt.toDateString() === dayKey);
        
        const counts = {
          [LogType.IN]: dayRecords.filter(r => r.type === LogType.IN).length,
          [LogType.OUT]: dayRecords.filter(r => r.type === LogType.OUT).length,
          [LogType.BREAK]: dayRecords.filter(r => r.type === LogType.BREAK).length,
        };

        last7Days.push({
          date: dateStr,
          ...counts,
          total: counts[LogType.IN] + counts[LogType.OUT] + counts[LogType.BREAK]
        });
      }
      setDistributionData(last7Days);

      // 2. Process Overtime Evolution
      const currentYear = new Date().getFullYear();
      const daysInMonth = new Date(currentYear, selectedMonth + 1, 0).getDate();
      const overtimeEvolution: OvertimeDataPoint[] = [];
      
      // Filtrar registros por departamento se necessário
      let filteredRecords = companyRecords;
      if (selectedDept !== 'ALL') {
        const deptEmployeeIds = employees.filter(e => e.departmentId === selectedDept).map(e => e.id);
        filteredRecords = companyRecords.filter(r => deptEmployeeIds.includes(r.userId));
      }

      let accumulated = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(currentYear, selectedMonth, d);
        const dayKey = date.toDateString();
        const dayRecs = filteredRecords.filter(r => r.createdAt.toDateString() === dayKey);
        
        // Cálculo simplificado: se tem Entrada e Saída, e passaram mais de 8h, o excesso é hora extra
        // Em um sistema real, isso usaria o PontoService.calculateDailyHours e subtrairia 8h
        if (dayRecs.length >= 2) {
          const hoursStr = PontoService.calculateDailyHours(dayRecs);
          const hoursNum = parseFloat(hoursStr.split('h')[0]) + (parseFloat(hoursStr.split('h')[1]) / 60);
          const overtime = Math.max(0, hoursNum - 8);
          accumulated += overtime;
        }

        overtimeEvolution.push({
          day: d,
          hours: Number(accumulated.toFixed(1)),
          label: `${d}/${selectedMonth + 1}`
        });
      }
      setOvertimeData(overtimeEvolution);

      setIsLoading(false);
    };
    loadData();
  }, [admin.companyId, selectedMonth, selectedDept]);

  const maxDailyTotal = useMemo(() => Math.max(...distributionData.map(d => d.total), 1), [distributionData]);
  const maxOvertime = useMemo(() => Math.max(...overtimeData.map(d => d.hours), 1), [overtimeData]);

  // Gerador de pontos para o gráfico de linha (SVG Path)
  const linePath = useMemo(() => {
    if (overtimeData.length === 0) return "";
    const width = 800;
    const height = 200;
    const padding = 20;
    const stepX = (width - padding * 2) / (overtimeData.length - 1);
    
    return overtimeData.map((p, i) => {
      const x = padding + i * stepX;
      const y = (height - padding) - ((p.hours / maxOvertime) * (height - padding * 2));
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  }, [overtimeData, maxOvertime]);

  const areaPath = useMemo(() => {
    if (overtimeData.length === 0) return "";
    const width = 800;
    const height = 200;
    const padding = 20;
    const lastX = padding + (overtimeData.length - 1) * ((width - padding * 2) / (overtimeData.length - 1));
    return `${linePath} L ${lastX} ${height - padding} L ${padding} ${height - padding} Z`;
  }, [linePath, overtimeData]);

  if (isLoading || !kpis) return <LoadingState message="Consolidando indicadores globais..." />;

  const cards = [
    {
      label: 'Pontualidade Global',
      value: `${kpis.punctuality}%`,
      icon: ShieldCheck,
      color: 'indigo',
      trend: kpis.trend.punctuality,
      desc: 'Marcações dentro da tolerância'
    },
    {
      label: 'Taxa de Absenteísmo',
      value: `${kpis.absenteeism}%`,
      icon: Activity,
      color: 'red',
      trend: kpis.trend.absenteeism,
      desc: 'Faltas e afastamentos'
    },
    {
      label: 'Horas Extras (Acumuladas)',
      value: `${kpis.overtimeHours}h`,
      icon: Zap,
      color: 'amber',
      trend: 'stable',
      desc: 'Mês atual vs período anterior'
    },
    {
      label: 'Média de Atraso',
      value: `${kpis.averageDelay}min`,
      icon: Clock,
      color: 'blue',
      trend: 'stable',
      desc: 'Média por colaborador atrasado'
    }
  ];

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card, idx) => (
          <div key={idx} className="glass-card p-8 rounded-[2.5rem] relative overflow-hidden group">
            <div className={`absolute top-0 right-0 w-24 h-24 bg-${card.color}-500/5 rounded-full -translate-y-8 translate-x-8 group-hover:scale-110 transition-transform`}></div>
            
            <div className="flex justify-between items-start mb-6">
              <div className={`p-3 bg-${card.color}-50 dark:bg-${card.color}-900/20 text-${card.color}-600 dark:text-${card.color}-400 rounded-2xl`}>
                <card.icon size={24} />
              </div>
              {card.trend !== 'stable' && (
                <div className={`flex items-center gap-1 text-[10px] font-black uppercase px-2 py-1 rounded-full ${card.trend === 'up' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  {card.trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {card.trend === 'up' ? 'Melhorando' : 'Atenção'}
                </div>
              )}
            </div>

            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{card.label}</p>
            <h4 className="text-4xl font-black text-slate-900 dark:text-white mb-2 tabular-nums">{card.value}</h4>
            <p className="text-[11px] text-slate-500 font-medium leading-none">{card.desc}</p>
          </div>
        ))}
      </div>

      {/* Gráficos Principais */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Gráfico de Evolução de Horas Extras (Novo) */}
        <div className="lg:col-span-12 glass-card p-10 rounded-[3rem] space-y-8">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <LineChart size={20} className="text-amber-500" />
                Evolução de Horas Extras
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-1">Acúmulo progressivo ao longo do mês selecionado</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-2 rounded-2xl">
                <Building size={14} className="text-slate-400 ml-2" />
                <select 
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="bg-transparent text-[10px] font-bold uppercase tracking-widest outline-none pr-4 cursor-pointer"
                >
                  <option value="ALL">Todos Deptos</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-2 rounded-2xl">
                <Calendar size={14} className="text-slate-400 ml-2" />
                <select 
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="bg-transparent text-[10px] font-bold uppercase tracking-widest outline-none pr-4 cursor-pointer"
                >
                  {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
              </div>
            </div>
          </header>

          <div className="relative h-64 w-full">
            <svg viewBox="0 0 800 200" className="w-full h-full preserve-3d">
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                </linearGradient>
              </defs>
              
              {/* Linhas de Grade */}
              <line x1="20" y1="20" x2="780" y2="20" stroke="currentColor" strokeOpacity="0.05" />
              <line x1="20" y1="90" x2="780" y2="90" stroke="currentColor" strokeOpacity="0.05" />
              <line x1="20" y1="180" x2="780" y2="180" stroke="currentColor" strokeOpacity="0.1" />

              {/* Área preenchida */}
              <path d={areaPath} fill="url(#areaGradient)" className="animate-in fade-in duration-1000" />
              
              {/* Linha do gráfico */}
              <path 
                d={linePath} 
                fill="none" 
                stroke="#f59e0b" 
                strokeWidth="3" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className="animate-in slide-in-from-left duration-1000"
              />

              {/* Pontos de dados interativos (mostra apenas alguns para não poluir) */}
              {overtimeData.filter((_, i) => i % 5 === 0 || i === overtimeData.length - 1).map((p, i, arr) => {
                const x = 20 + (p.day - 1) * (760 / (overtimeData.length - 1));
                const y = 180 - ((p.hours / maxOvertime) * 160);
                return (
                  <g key={i} className="group/point cursor-help">
                    <circle cx={x} cy={y} r="4" fill="#f59e0b" className="transition-all group-hover/point:r-6" />
                    <text x={x} y={y - 10} textAnchor="middle" className="text-[8px] font-bold fill-slate-400 opacity-0 group-hover/point:opacity-100 transition-opacity">
                      {p.hours}h
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="absolute bottom-[-20px] left-0 w-full flex justify-between px-5">
               <span className="text-[8px] font-bold text-slate-400">01/{selectedMonth+1}</span>
               <span className="text-[8px] font-bold text-slate-400">{overtimeData.length}/{selectedMonth+1}</span>
            </div>
          </div>
        </div>

        {/* Gráfico de Distribuição de Tipos de Ponto */}
        <div className="lg:col-span-8 glass-card p-10 rounded-[3rem] space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <BarChart3 size={20} className="text-indigo-600" />
                Atividade Operacional
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-1">Volume de marcações por tipo nos últimos 7 dias</p>
            </div>
            
            <div className="flex items-center gap-4">
               <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Entrada</span>
               </div>
               <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Pausa</span>
               </div>
               <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-400"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Saída</span>
               </div>
            </div>
          </div>

          <div className="h-64 flex items-end gap-4 md:gap-8 pt-10 px-4">
            {distributionData.map((day, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-4 group h-full">
                <div className="relative w-full h-full flex flex-col justify-end">
                   {/* Stacked Bars */}
                   <div 
                    className="w-full bg-slate-400 rounded-t-lg transition-all duration-700 delay-300" 
                    style={{ height: `${(day[LogType.OUT] / maxDailyTotal) * 100}%` }}
                   ></div>
                   <div 
                    className="w-full bg-amber-500 transition-all duration-700 delay-200" 
                    style={{ height: `${(day[LogType.BREAK] / maxDailyTotal) * 100}%` }}
                   ></div>
                   <div 
                    className="w-full bg-indigo-600 transition-all duration-700 delay-100" 
                    style={{ height: `${(day[LogType.IN] / maxDailyTotal) * 100}%` }}
                   ></div>

                   {/* Tooltip on Hover */}
                   <div className="absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white p-2 rounded-lg text-[9px] z-20 whitespace-nowrap shadow-xl">
                      <p>E: {day[LogType.IN]}</p>
                      <p>P: {day[LogType.BREAK]}</p>
                      <p>S: {day[LogType.OUT]}</p>
                   </div>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{day.date}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Lado Direito: Motivos de Ausência */}
        <div className="lg:col-span-4 glass-card p-10 rounded-[3rem] space-y-8">
           <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Motivos de Ausência</h3>
              <p className="text-xs text-slate-400 font-medium mt-1">Consolidado Mensal</p>
           </div>
           
           <div className="space-y-6">
              {[
                { label: 'Saúde / Médicos', val: 45, color: 'bg-indigo-600' },
                { label: 'Problemas Pessoais', val: 25, color: 'bg-blue-500' },
                { label: 'Trânsito / Atraso', val: 18, color: 'bg-amber-500' },
                { label: 'Outros', val: 12, color: 'bg-slate-300' },
              ].map((item, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                    <span className="text-slate-500">{item.label}</span>
                    <span className="text-slate-900 dark:text-white">{item.val}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${item.color} transition-all duration-1000`} 
                      style={{ width: `${item.val}%` }}
                    ></div>
                  </div>
                </div>
              ))}
           </div>

           <div className="pt-6 border-t border-slate-50 dark:border-slate-800">
              <div className="p-5 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 flex items-start gap-3">
                <AlertCircle size={18} className="text-indigo-600 mt-0.5" />
                <p className="text-[10px] text-indigo-700 dark:text-indigo-300 font-medium leading-relaxed">
                  <strong>Insight SmartPonto:</strong> O volume de pausas aumentou 5% no período da tarde, sugerindo necessidade de revisão do fluxo de café.
                </p>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
};

export default AnalyticsView;
