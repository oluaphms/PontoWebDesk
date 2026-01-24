
import React, { useState, useEffect, useMemo } from 'react';
import { PontoService } from '../services/pontoService';
import { User, LogType } from '../types';
import { LoadingState, Badge } from './UI';
import { 
  BarChart as BarChartIcon, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock,
  Info,
  Activity
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell
} from 'recharts';

interface PunchDistributionViewProps {
  admin: User;
}

interface DailyStats {
  date: string;
  entrada: number;
  saída: number;
  pausa: number;
  total: number;
}

const PunchDistributionView: React.FC<PunchDistributionViewProps> = ({ admin }) => {
  const [data, setData] = useState<DailyStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      const allRecords = await PontoService.loadAllRecords();
      const companyRecords = allRecords.filter(r => r.companyId === admin.companyId);
      
      const last7Days: DailyStats[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayKey = date.toDateString();
        const dateStr = date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });

        const dayRecords = companyRecords.filter(r => r.createdAt.toDateString() === dayKey);
        
        const stats: DailyStats = {
          date: dateStr,
          entrada: dayRecords.filter(r => r.type === LogType.IN).length,
          saída: dayRecords.filter(r => r.type === LogType.OUT).length,
          pausa: dayRecords.filter(r => r.type === LogType.BREAK).length,
          total: dayRecords.length
        };
        last7Days.push(stats);
      }
      
      setData(last7Days);
      setIsLoading(false);
    };

    fetchData();
  }, [admin.companyId]);

  const totals = useMemo(() => {
    return {
      entrada: data.reduce((acc, curr) => acc + curr.entrada, 0),
      saída: data.reduce((acc, curr) => acc + curr.saída, 0),
      pausa: data.reduce((acc, curr) => acc + curr.pausa, 0),
    };
  }, [data]);

  if (isLoading) return <LoadingState message="Mapeando fluxo de marcações..." />;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 p-4 rounded-2xl shadow-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-white/10 pb-2">{label}</p>
          <div className="space-y-2">
            {payload.map((entry: any, index: number) => (
              <div key={index} className="flex justify-between items-center gap-6">
                <div className="flex items-center gap-2">
                   <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
                   <span className="text-xs font-bold text-slate-200 capitalize">{entry.name}:</span>
                </div>
                <span className="text-xs font-black text-white tabular-nums">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Entradas (7d)', value: totals.entrada, color: 'indigo', icon: ArrowUpRight },
          { label: 'Saídas (7d)', value: totals.saída, color: 'slate', icon: ArrowDownRight },
          { label: 'Pausas (7d)', value: totals.pausa, color: 'amber', icon: Clock },
        ].map((card, i) => (
          <div key={i} className="glass-card p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800">
             <div className="flex justify-between items-start mb-4">
                <div className={`p-3 bg-${card.color}-50 dark:bg-${card.color}-900/20 text-${card.color}-600 dark:text-${card.color}-400 rounded-2xl`}>
                   <card.icon size={20} />
                </div>
                <Badge color={card.color === 'indigo' ? 'indigo' : (card.color === 'amber' ? 'amber' : 'slate')}>Global</Badge>
             </div>
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{card.label}</p>
             <h4 className="text-3xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">{card.value}</h4>
          </div>
        ))}
      </div>

      <div className="glass-card p-10 rounded-[3rem] border border-slate-100 dark:border-slate-800">
         <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-12">
            <div>
               <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  <Activity size={20} className="text-indigo-600" />
                  Punch Type Distribution (Last 7 Days)
               </h3>
               <p className="text-xs text-slate-400 font-medium mt-1">Comparativo cronológico de registros por tipo</p>
            </div>
         </header>

         <div className="h-96 w-full pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} 
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(79, 70, 229, 0.05)' }} />
                <Legend 
                  iconType="circle" 
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ paddingBottom: '30px', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }} 
                />
                <Bar dataKey="entrada" name="Entrada" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="pausa" name="Pausa" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="saída" name="Saída" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
         </div>
         
         <div className="mt-12 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl flex items-start gap-4 border border-slate-100 dark:border-slate-700/50">
            <Info size={18} className="text-slate-400 mt-1" />
            <div className="space-y-1">
               <p className="text-xs font-bold text-slate-700 dark:text-white">Análise de Fluxo Operacional</p>
               <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                  A distribuição acima permite visualizar os horários de pico e a aderência dos colaboradores às pausas regulamentares. Os dados são atualizados em tempo real conforme as batidas são validadas pelo sistema de geofencing.
               </p>
            </div>
         </div>
      </div>
    </div>
  );
};

export default PunchDistributionView;
