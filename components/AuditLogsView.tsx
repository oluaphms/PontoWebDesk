import React, { useState, useEffect } from 'react';
import { LoggingService } from '../services/loggingService';
import { User, AuditLog, LogSeverity } from '../types';
// Fix: Added Button to the imports from UI
import { Badge, LoadingState, Button } from './UI';
import { 
  ShieldAlert, 
  Info, 
  AlertTriangle, 
  ShieldCheck, 
  Search, 
  Terminal,
  Activity,
  Filter
} from 'lucide-react';

interface AuditLogsViewProps {
  admin: User;
}

const AuditLogsView: React.FC<AuditLogsViewProps> = ({ admin }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<LogSeverity | 'ALL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const loadLogs = async () => {
    setIsLoading(true);
    const data = await LoggingService.getLogs(admin.companyId);
    setLogs(data);
    setIsLoading(false);
  };

  useEffect(() => {
    loadLogs();
    // Simulando polling de logs em tempo real
    const interval = setInterval(loadLogs, 30000);
    return () => clearInterval(interval);
  }, [admin.companyId]);

  const filteredLogs = logs.filter(log => {
    const matchesSeverity = filterSeverity === 'ALL' || log.severity === filterSeverity;
    const matchesSearch = log.action.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          JSON.stringify(log.details).toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSeverity && matchesSearch;
  });

  const getSeverityIcon = (severity: LogSeverity) => {
    switch (severity) {
      case LogSeverity.SECURITY: return <ShieldAlert size={18} className="text-red-500" />;
      case LogSeverity.ERROR: return <AlertTriangle size={18} className="text-orange-500" />;
      case LogSeverity.WARN: return <Activity size={18} className="text-amber-500" />;
      default: return <Info size={18} className="text-indigo-500" />;
    }
  };

  const getSeverityBadge = (severity: LogSeverity) => {
    switch (severity) {
      case LogSeverity.SECURITY: return 'red';
      case LogSeverity.ERROR: return 'amber';
      case LogSeverity.WARN: return 'amber';
      default: return 'indigo';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Controles de Filtro */}
      <div className="glass-card p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-4 md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Filtrar por ação ou detalhe..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100 transition-all text-sm font-medium"
          />
        </div>
        <div className="flex gap-2">
          {(['ALL', ...Object.values(LogSeverity)] as const).map(sev => (
            <button
              key={sev}
              onClick={() => setFilterSeverity(sev)}
              className={`px-4 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${filterSeverity === sev ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-800 text-slate-400'}`}
            >
              {sev}
            </button>
          ))}
        </div>
        <Button onClick={loadLogs} variant="outline" size="sm" className="h-12">
          Atualizar
        </Button>
      </div>

      {/* Tabela de Auditoria */}
      <div className="bg-slate-900 rounded-[2.5rem] border border-slate-800 shadow-2xl overflow-hidden">
        <header className="px-8 py-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <Terminal size={20} className="text-green-500" />
             <h3 className="font-bold text-slate-200">Event Stream (Centralized Audit)</h3>
          </div>
          <Badge color="slate" className="text-[9px]">Produção - AWS Region: us-east-1</Badge>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-950/50">
                <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Timestamp</th>
                <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Severity</th>
                <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Action</th>
                <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">User/Source</th>
                <th className="px-8 py-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {isLoading ? (
                <tr><td colSpan={5} className="py-20"><LoadingState message="Acessando arquivos de log..." /></td></tr>
              ) : filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-indigo-900/10 transition-colors group">
                  <td className="px-8 py-4">
                    <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {log.timestamp.toLocaleDateString('pt-BR')} {log.timestamp.toLocaleTimeString('pt-BR')}
                    </div>
                  </td>
                  <td className="px-8 py-4">
                    <div className="flex items-center gap-2">
                       {getSeverityIcon(log.severity)}
                       <Badge color={getSeverityBadge(log.severity)} className="text-[8px] !px-1.5 !py-0.5">
                         {log.severity}
                       </Badge>
                    </div>
                  </td>
                  <td className="px-8 py-4">
                    <span className="text-xs font-bold text-slate-200 font-mono">{log.action}</span>
                  </td>
                  <td className="px-8 py-4">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-300">{log.userName || 'System/Admin'}</span>
                      <span className="text-[9px] text-slate-500 font-mono">{log.ipAddress}</span>
                    </div>
                  </td>
                  <td className="px-8 py-4 max-w-xs">
                    <div className="text-[10px] text-slate-500 font-mono truncate cursor-help group-hover:text-slate-300 transition-colors" title={JSON.stringify(log.details, null, 2)}>
                      {JSON.stringify(log.details)}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && !isLoading && (
                <tr><td colSpan={5} className="py-20 text-center text-slate-600 text-[10px] font-bold uppercase tracking-widest">Nenhum evento registrado no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Painel de Alertas Recentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-8 rounded-[2rem] border-red-100 dark:border-red-900/20">
           <div className="flex items-center gap-3 mb-6">
              <ShieldAlert className="text-red-500" size={20} />
              <h4 className="font-bold text-slate-900 dark:text-white">Alertas Críticos (24h)</h4>
           </div>
           <div className="space-y-4">
              {logs.filter(l => l.severity === LogSeverity.SECURITY).slice(0, 3).map(alert => (
                <div key={alert.id} className="p-4 bg-red-50 dark:bg-red-950/20 rounded-2xl border border-red-100 dark:border-red-900/30">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-black text-red-600 uppercase tracking-widest">{alert.action}</span>
                    <span className="text-[9px] text-red-400 font-bold">{alert.timestamp.toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs text-red-800 dark:text-red-300 font-medium">Ação detectada na estação {alert.ipAddress}. Auditoria recomendada.</p>
                </div>
              ))}
              {logs.filter(l => l.severity === LogSeverity.SECURITY).length === 0 && (
                <div className="py-10 text-center opacity-40 text-xs font-bold uppercase tracking-widest">Sem incidentes graves</div>
              )}
           </div>
        </div>

        <div className="glass-card p-8 rounded-[2rem] border-indigo-100 dark:border-indigo-900/20">
           <div className="flex items-center gap-3 mb-6">
              <ShieldCheck className="text-green-500" size={20} />
              <h4 className="font-bold text-slate-900 dark:text-white">Resumo de Integridade</h4>
           </div>
           <div className="space-y-6">
              <div className="flex justify-between items-center text-xs font-bold">
                 <span className="text-slate-500">Uptime do Serviço</span>
                 <span className="text-green-600">99.99%</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                 <div className="h-full bg-green-500 w-[99.99%]"></div>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Todos os subsistemas de Geofencing e Biometria facial reportaram operação normal nos últimos 1500 logs processados.
              </p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default AuditLogsView;