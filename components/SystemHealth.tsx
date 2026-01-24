
import React, { useState, useEffect } from 'react';
import { TestingService, TestResult } from '../services/testingService';
import { Button, Badge, LoadingState } from './UI';
import { ShieldCheck, Play, CheckCircle, XCircle, Activity, Server, Zap } from 'lucide-react';

const SystemHealth: React.FC = () => {
  const [results, setResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const runTests = async () => {
    setIsRunning(true);
    // Pequeno delay para feedback visual de 'processamento'
    await new Promise(r => setTimeout(r, 800));
    const tests = await TestingService.runAllTests();
    setResults(tests);
    setLastRun(new Date());
    setIsRunning(false);
  };

  useEffect(() => {
    runTests();
  }, []);

  const stats = {
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Status Geral */}
        <div className="lg:col-span-1 glass-card p-10 rounded-[3rem] space-y-8">
           <div className="flex flex-col items-center text-center">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 transition-colors ${stats.failed > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                <ShieldCheck size={48} />
              </div>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Saúde do Core</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {stats.failed > 0 
                  ? `${stats.failed} falha(s) de regra de negócio detectada(s).` 
                  : 'Todos os módulos de cálculo e validação operando nominalmente.'}
              </p>
           </div>

           <div className="space-y-4 pt-6 border-t border-slate-50 dark:border-slate-800">
              <div className="flex justify-between items-center">
                 <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Testes Passados</span>
                 <span className="text-xl font-black text-green-600">{stats.passed}/{stats.total}</span>
              </div>
              <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                 <div 
                   className="h-full bg-green-500 transition-all duration-1000"
                   style={{ width: `${(stats.passed / stats.total) * 100}%` }}
                 ></div>
              </div>
           </div>

           <Button onClick={runTests} loading={isRunning} className="w-full h-14" variant={stats.failed > 0 ? 'primary' : 'outline'}>
              <Play size={18} /> Re-executar Auditoria
           </Button>
           
           {lastRun && (
             <p className="text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest">
                Último check: {lastRun.toLocaleTimeString()}
             </p>
           )}
        </div>

        {/* Lista de Testes */}
        <div className="lg:col-span-2 space-y-6">
           <div className="flex items-center justify-between px-2">
              <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Zap size={18} className="text-amber-500" /> Resultados do Test Suite
              </h4>
              <Badge color="slate">Produção v1.0.4-LTS</Badge>
           </div>

           <div className="space-y-4 h-[500px] overflow-y-auto custom-scrollbar pr-2">
              {results.map((test, idx) => (
                <div key={idx} className="glass-card p-6 rounded-3xl flex items-center justify-between group hover:border-indigo-200 transition-all">
                  <div className="flex items-center gap-5">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${test.status === 'passed' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      {test.status === 'passed' ? <CheckCircle size={24} /> : <XCircle size={24} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {test.category}
                        </span>
                        <h5 className="text-sm font-bold text-slate-900 dark:text-white">{test.name}</h5>
                      </div>
                      {test.status === 'failed' && (
                        <p className="text-xs text-red-500 font-medium">{test.error}</p>
                      )}
                      {test.status === 'passed' && (
                        <p className="text-xs text-slate-400 font-medium">Validação concluída sem erros.</p>
                      )}
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Badge color={test.status === 'passed' ? 'green' : 'red'}>
                       {test.status === 'passed' ? 'Success' : 'Error'}
                    </Badge>
                  </div>
                </div>
              ))}

              {results.length === 0 && !isRunning && (
                <div className="py-20 text-center opacity-40">Aguardando execução...</div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default SystemHealth;
