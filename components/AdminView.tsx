
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PontoService } from '../services/pontoService';
import { LoggingService } from '../services/loggingService';
import { PermissionService } from '../services/permissionService';
import { adminUserService } from '../services/adminUserService';
import { EmployeeSummary, TimeRecord, User, Company, PunchMethod, LogType, LogSeverity, AuditLog, UserRole } from '../types';
import { Button, Input, Badge, LoadingState } from './UI';
import ReportsView from './ReportsView';
import AnalyticsView from './AnalyticsView';
import SystemHealth from './SystemHealth';
import AuditLogsView from './AuditLogsView';
import PunchDistributionView from './PunchDistributionView';
import GeoIntelligenceView from './GeoIntelligenceView'; // Import novo componente
import { 
  Users, 
  Search, 
  Edit3, 
  MapPin,
  Building2,
  Settings,
  Save,
  CheckCircle2,
  ShieldCheck,
  X,
  Smartphone,
  BarChart3,
  BrainCircuit,
  ShieldCheck as ShieldIcon,
  ShieldAlert,
  ClipboardList,
  Sun,
  Moon,
  Monitor,
  LayoutGrid,
  HelpCircle,
  LocateFixed,
  BarChart,
  Navigation,
  Radio,
  BellRing,
  AlertTriangle,
  Map, // Import Map icon
  UserPlus,
  Upload,
  Download,
  FileSpreadsheet
} from 'lucide-react';

interface AdminViewProps {
  admin: User;
}

const AdminView: React.FC<AdminViewProps> = ({ admin }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeSummary | null>(null);
  const [empRecords, setEmpRecords] = useState<TimeRecord[]>([]);
  const [adminTab, setAdminTab] = useState<'employees' | 'settings' | 'reports' | 'analytics' | 'quality' | 'logs' | 'punch-distribution' | 'geo-intelligence'>('employees');
  
  const [adjustingRecord, setAdjustingRecord] = useState<TimeRecord | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState({ type: LogType.IN, time: '09:00', reason: '' });
  const [isAdjusting, setIsAdjusting] = useState(false);

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const notifyTimeoutRef = useRef<any>(null);
  const [criticalNotify, setCriticalNotify] = useState<AuditLog | null>(null);

  // Cadastro de funcionários
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    nome: '',
    email: '',
    password: '',
    cargo: '',
    departmentId: '',
    role: 'employee' as UserRole,
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = LoggingService.subscribe((log) => {
      if (log.companyId === admin.companyId) {
        setCriticalNotify(log);
        if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
        notifyTimeoutRef.current = setTimeout(() => {
          setCriticalNotify(null);
        }, 8000);
      }
    });
    return () => {
      unsubscribe();
      if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
    };
  }, [admin.companyId]);

  const [adminTheme, setAdminTheme] = useState<'system' | 'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('smartponto_admin_theme_mode') as any) || 'system';
    } catch (err) {
      console.warn('[AdminView] Falha ao ler tema admin:', err);
      return 'system';
    }
  });

  const applyTheme = useCallback((theme: 'system' | 'light' | 'dark') => {
    const root = document.documentElement;
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', isDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }, []);

  const handleThemeChange = (newTheme: 'system' | 'light' | 'dark') => {
    setAdminTheme(newTheme);
    try {
      localStorage.setItem('smartponto_admin_theme_mode', newTheme);
    } catch (err) {
      console.warn('[AdminView] Falha ao salvar tema admin:', err);
    }
    applyTheme(newTheme);
    LoggingService.log({
      severity: LogSeverity.INFO,
      action: 'ADMIN_THEME_CHANGE',
      userId: admin.id,
      companyId: admin.companyId,
      details: { newTheme }
    });
  };

  useEffect(() => {
    if (adminTheme !== 'system') applyTheme(adminTheme);
  }, [adminTheme, applyTheme]);

  // ✅ OTIMIZADO: Usar React Query para cache automático
  const queryClient = useQueryClient();

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ['employees', admin.companyId],
    queryFn: () => PontoService.getAllEmployees(admin.companyId),
    staleTime: 5 * 60 * 1000, // 5 minutos
  });

  const { data: company } = useQuery({
    queryKey: ['company', admin.companyId],
    queryFn: () => PontoService.getCompany(admin.companyId),
    staleTime: 10 * 60 * 1000, // 10 minutos
  });

  const patchCompanyFence = (partial: Partial<Company['settings']['fence']>) => {
    queryClient.setQueryData<Company | undefined>(['company', admin.companyId], (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          fence: { ...prev.settings.fence, ...partial },
        },
      };
    });
  };

  // ✅ OTIMIZADO: Usar useMutation para criar funcionário
  const { mutate: createEmployee, isPending: isCreating, error: createErrorMutation } = useMutation({
    mutationFn: (data: typeof createForm) => adminUserService.createEmployee(admin, data),
    onSuccess: (result) => {
      if (result.success) {
        setCreateSuccess(true);
        setCreateForm({
          nome: '',
          email: '',
          password: '',
          cargo: '',
          departmentId: '',
          role: 'employee',
        });
        // Invalidar cache de funcionários
        queryClient.invalidateQueries({ queryKey: ['employees', admin.companyId] });
        setTimeout(() => {
          setShowCreateModal(false);
          setCreateSuccess(false);
        }, 2000);
      } else {
        setCreateError(result.error || 'Erro ao criar funcionário');
      }
    },
    onError: (error: any) => {
      setCreateError(error.message || 'Erro ao criar funcionário');
    },
  });

  // ✅ OTIMIZADO: Usar useMutation para importar funcionários
  const { mutate: importEmployees, isPending: isImporting } = useMutation({
    mutationFn: async (file: File) => {
      return await adminUserService.importEmployees(admin, file);
    },
    onSuccess: (result) => {
      setImportResult(result);
      // Invalidar cache de funcionários
      queryClient.invalidateQueries({ queryKey: ['employees', admin.companyId] });
      setShowImportModal(false);
    },
    onError: (error: any) => {
      setImportResult({
        total: 0,
        success: 0,
        errors: [{ row: 0, email: '', error: error.message || 'Erro ao importar planilha' }],
      });
    },
  });

  const handleImportEmployeesForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    importEmployees(importFile);
  };

  const handleDownloadTemplate = async () => {
    await adminUserService.downloadTemplate();
  };

  const handleSelectEmployee = async (emp: EmployeeSummary) => {
    setSelectedEmployee(emp);
    const records = await PontoService.getRecords(emp.id);
    setEmpRecords(records);
  };

  const handleOpenAdjustment = (rec: TimeRecord) => {
    setAdjustingRecord(rec);
    const timeStr = rec.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setAdjustmentForm({ type: rec.type, time: timeStr, reason: '' });
  };

  const handleConfirmAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingRecord) return;
    setIsAdjusting(true);
    try {
      const updated = await PontoService.adjustRecord(admin, adjustingRecord.id, adjustmentForm);
      setEmpRecords(prev => prev.map(r => r.id === updated.id ? updated : r));
      setAdjustingRecord(null);
      queryClient.invalidateQueries({ queryKey: ['employees', admin.companyId] });
    } catch (err) {
      console.error(err);
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    setIsSavingSettings(true);
    try {
      await PontoService.updateCompanySettings(company.id, company.settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const getRiskColor = (score: number) => {
    if (score > 60) return 'text-red-500 bg-red-50 dark:bg-red-900/20';
    if (score > 30) return 'text-amber-500 bg-amber-50 dark:bg-amber-900/20';
    return 'text-green-500 bg-green-50 dark:bg-green-900/20';
  };

  const filteredEmployees = employees.filter(e => 
    e.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
    e.cargo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 relative">
      {criticalNotify && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-2xl animate-in slide-in-from-top-10 duration-500 pointer-events-none">
          <div className="glass-card !bg-white/90 dark:!bg-slate-900/90 backdrop-blur-2xl border-2 border-red-500/20 dark:border-red-500/40 p-4 rounded-3xl shadow-[0_30px_60px_-15px_rgba(239,68,68,0.3)] flex items-center gap-5 pointer-events-auto">
            <div className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${criticalNotify.severity === LogSeverity.SECURITY ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'} shadow-lg shadow-red-500/20`}>
              {criticalNotify.severity === LogSeverity.SECURITY ? <ShieldAlert size={24} /> : <AlertTriangle size={24} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-400">Alerta de {criticalNotify.severity === LogSeverity.SECURITY ? 'Segurança' : 'Sistema'}</span>
                <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                <span className="text-[10px] font-bold text-slate-400 tabular-nums">{criticalNotify.timestamp.toLocaleTimeString()}</span>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{criticalNotify.action}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Origem: {criticalNotify.userName || 'Sistema'}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setAdminTab('logs')} className="px-4 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-black uppercase tracking-widest rounded-xl">Auditar</button>
              <button onClick={() => setCriticalNotify(null)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><X size={18} /></button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
               <Building2 size={16} className="text-indigo-600" />
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Painel Administrativo</span>
            </div>
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white leading-none">
              {adminTab === 'employees' ? 'Funcionários' : 
               adminTab === 'reports' ? 'Relatórios de Ponto' : 
               adminTab === 'analytics' ? 'Inteligência de Dados' : 
               adminTab === 'punch-distribution' ? 'Espelho de Ponto' :
               adminTab === 'geo-intelligence' ? 'Geo Inteligência AI' :
               adminTab === 'quality' ? 'Qualidade de Software' : 
               adminTab === 'logs' ? 'Logs e Auditoria' : 'Configurações'}
            </h2>
          </div>
          
          <div className="hidden sm:flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
             <button onClick={() => handleThemeChange('light')} className={`p-2 rounded-xl transition-all ${adminTheme === 'light' ? 'bg-white dark:bg-slate-700 text-amber-500 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`} title="Modo Claro"><Sun size={16} /></button>
             <button onClick={() => handleThemeChange('dark')} className={`p-2 rounded-xl transition-all ${adminTheme === 'dark' ? 'bg-white dark:bg-slate-700 text-indigo-500 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`} title="Modo Escuro"><Moon size={16} /></button>
             <button onClick={() => handleThemeChange('system')} className={`p-2 rounded-xl transition-all ${adminTheme === 'system' ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`} title="Seguir Sistema"><Monitor size={16} /></button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setAdminTab('employees')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'employees'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <Users size={16} /> Funcionários
          </button>
          <button
            onClick={() => setAdminTab('punch-distribution')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'punch-distribution'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <BarChart size={16} /> Espelho de Ponto
          </button>
          <button
            onClick={() => setAdminTab('reports')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'reports'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <BarChart3 size={16} /> Relatórios
          </button>
          <button
            onClick={() => setAdminTab('settings')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'settings'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <Settings size={16} /> Configurações
          </button>
          <button
            onClick={() => setAdminTab('analytics')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'analytics'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <BrainCircuit size={16} /> Analytics
          </button>
          <button
            onClick={() => setAdminTab('geo-intelligence')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'geo-intelligence'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <Map size={16} /> Geo Intelligence
          </button>
          <button
            onClick={() => setAdminTab('logs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'logs'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 relative'
            }`}
          >
            <ClipboardList size={16} /> Logs
            {criticalNotify && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 animate-ping"></span>
            )}
          </button>
          <button
            onClick={() => setAdminTab('quality')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              adminTab === 'quality'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <ShieldIcon size={16} /> SQA
          </button>
        </div>
      </header>

      {adminTab === 'employees' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm transition-all shadow-lg shadow-indigo-600/20"
              >
                <UserPlus size={18} /> Cadastrar
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-2xl font-bold text-sm transition-all shadow-lg"
              >
                <Upload size={18} /> Importar
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input type="text" placeholder="Buscar colaborador..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100 transition-all dark:text-white" />
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden h-[600px] overflow-y-auto custom-scrollbar">
              {filteredEmployees.map(emp => (
                <button key={emp.id} onClick={() => handleSelectEmployee(emp)} className={`w-full p-5 flex items-center gap-4 transition-all border-b border-slate-50 dark:border-slate-800 last:border-none text-left ${selectedEmployee?.id === emp.id ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold shrink-0">{emp.nome.charAt(0)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white truncate">{emp.nome}</p>
                    <div className="flex items-center gap-2">
                       <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight truncate">{emp.cargo}</p>
                       <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase ${getRiskColor(emp.riskScore)}`}>Risk: {emp.riskScore}</span>
                    </div>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${emp.status === 'working' ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
                </button>
              ))}
            </div>
          </div>
          <div className="lg:col-span-8">
            {selectedEmployee ? (
              <div className="space-y-6">
                <div className="glass-card rounded-[2rem] p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 rounded-3xl bg-indigo-600 text-white flex items-center justify-center text-3xl font-bold shadow-xl shadow-indigo-600/20">{selectedEmployee.nome.charAt(0)}</div>
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{selectedEmployee.nome}</h3>
                      <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">{selectedEmployee.cargo}</p>
                    </div>
                  </div>
                  <div className="flex gap-8">
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saldo Hoje</p>
                      <p className="text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">{selectedEmployee.todayHours}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                  <table className="w-full text-left">
                    <thead><tr className="bg-slate-50 dark:bg-slate-800"><th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase">Integridade</th><th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase">Horário</th><th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase text-right">Ação</th></tr></thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {empRecords.map(rec => (
                        <tr key={rec.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-5"><Badge color={rec.fraudFlags && rec.fraudFlags.length > 0 ? 'red' : 'green'}>{rec.fraudFlags && rec.fraudFlags.length > 0 ? 'Risco Detectado' : 'Validado'}</Badge></td>
                          <td className="px-6 py-5"><div className="text-sm font-bold text-slate-900 dark:text-white">{rec.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div></td>
                          <td className="px-6 py-5 text-right"><button onClick={() => handleOpenAdjustment(rec)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-all"><Edit3 size={18} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center py-24 glass-card rounded-[2rem] border-dashed border-2 text-center p-8 border-slate-200 dark:border-slate-800">
                <ShieldAlert size={40} className="text-slate-300 mb-6" />
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Central de Inteligência</h3>
                <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-xs text-xs">Selecione um colaborador para analisar conformidade.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {adminTab === 'reports' && <ReportsView admin={admin} />}
      {adminTab === 'analytics' && <AnalyticsView admin={admin} />}
      {adminTab === 'punch-distribution' && <PunchDistributionView admin={admin} />}
      {adminTab === 'geo-intelligence' && company && <GeoIntelligenceView admin={admin} company={company} />}
      {adminTab === 'quality' && <SystemHealth />}
      {adminTab === 'logs' && <AuditLogsView admin={admin} />}

      {adminTab === 'settings' && company && (
        <div className="max-w-4xl animate-in slide-in-from-right-6 duration-500 space-y-8">
           <form onSubmit={handleSaveSettings} className="space-y-8">
                <div className="grid grid-cols-1 gap-8">
                  <div className="glass-card p-10 rounded-[3rem] space-y-8">
                    <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 rounded-xl"><MapPin size={24}/></div><h4 className="font-bold text-slate-900 dark:text-white text-xl">Configuração de Cerca Virtual</h4></div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Latitude</label>
                        <Input type="number" step="any" value={company.settings.fence.lat} onChange={e => patchCompanyFence({ lat: parseFloat(e.target.value) })} />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Longitude</label>
                        <Input type="number" step="any" value={company.settings.fence.lng} onChange={e => patchCompanyFence({ lng: parseFloat(e.target.value) })} />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Raio (m)</label>
                        <Input type="number" value={company.settings.fence.radius} onChange={e => patchCompanyFence({ radius: parseInt(e.target.value, 10) })} />
                      </div>
                    </div>
                  </div>
                  {/* Outras configurações... */}
                </div>
                <div className="flex justify-end pt-6">
                  <Button loading={isSavingSettings} type="submit" className="h-20 px-16 text-xl rounded-[2.5rem] shadow-2xl shadow-indigo-600/30">
                    {saveSuccess ? <><CheckCircle2 size={28} /> Salvo</> : <><Save size={28} /> Salvar Alterações</>}
                  </Button>
                </div>
           </form>
        </div>
      )}

      {adjustingRecord && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-300">
           <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl overflow-hidden border border-white/10 animate-in zoom-in-95 duration-300">
              <header className="px-10 py-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between"><h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">Ajustar Registro</h3><button onClick={() => setAdjustingRecord(null)} className="p-3 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all"><X size={24}/></button></header>
              <form onSubmit={handleConfirmAdjustment} className="p-10 space-y-8"><Input label="Novo Horário" type="time" value={adjustmentForm.time} onChange={e => setAdjustmentForm({...adjustmentForm, time: e.target.value})} /><textarea required value={adjustmentForm.reason} onChange={e => setAdjustmentForm({...adjustmentForm, reason: e.target.value})} placeholder="Motivo do ajuste..." className="w-full p-6 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-indigo-100 h-32 resize-none" /><div className="flex gap-4"><Button onClick={() => setAdjustingRecord(null)} type="button" variant="outline" className="flex-1 h-16">Cancelar</Button><Button loading={isAdjusting} type="submit" className="flex-2 h-16">Confirmar Ajuste</Button></div></form>
           </div>
        </div>
      )}

      {/* Modal Cadastro Manual */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl overflow-hidden border border-white/10 animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
            <header className="px-10 py-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">Cadastrar Funcionário</h3>
              <button onClick={() => { setShowCreateModal(false); setCreateError(null); setCreateSuccess(false); }} className="p-3 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all">
                <X size={24} />
              </button>
            </header>
            <form onSubmit={(e) => { e.preventDefault(); createEmployee(createForm); }} className="p-10 space-y-6">
              {createSuccess && (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3 text-green-600 dark:text-green-400 text-sm font-bold">
                  <CheckCircle2 size={20} /> Funcionário criado com sucesso!
                </div>
              )}
              {createError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-600 dark:text-red-400 text-sm font-bold">
                  <AlertTriangle size={20} /> {createError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Nome Completo *</label>
                  <Input
                    type="text"
                    value={createForm.nome}
                    onChange={e => setCreateForm({...createForm, nome: e.target.value})}
                    required
                    placeholder="João Silva"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Email *</label>
                  <Input
                    type="email"
                    value={createForm.email}
                    onChange={e => setCreateForm({...createForm, email: e.target.value})}
                    required
                    placeholder="joao@empresa.com"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Senha *</label>
                  <Input
                    type="password"
                    value={createForm.password}
                    onChange={e => setCreateForm({...createForm, password: e.target.value})}
                    required
                    placeholder="Mínimo 6 caracteres"
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Cargo *</label>
                  <Input
                    type="text"
                    value={createForm.cargo}
                    onChange={e => setCreateForm({...createForm, cargo: e.target.value})}
                    required
                    placeholder="Desenvolvedor"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Departamento</label>
                  <Input
                    type="text"
                    value={createForm.departmentId}
                    onChange={e => setCreateForm({...createForm, departmentId: e.target.value})}
                    placeholder="TI (opcional)"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Role</label>
                  <select
                    value={createForm.role}
                    onChange={e => setCreateForm({...createForm, role: e.target.value as UserRole})}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 transition-all text-sm"
                  >
                    <option value="employee">Funcionário</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="hr">RH</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <Button onClick={() => { setShowCreateModal(false); setCreateError(null); setCreateSuccess(false); }} type="button" variant="outline" className="flex-1 h-14">
                  Cancelar
                </Button>
                <Button loading={isCreating} type="submit" className="flex-2 h-14">
                  Criar Funcionário
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Importação */}
      {showImportModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl overflow-hidden border border-white/10 animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
            <header className="px-10 py-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">Importar Funcionários</h3>
              <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportResult(null); }} className="p-3 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all">
                <X size={24} />
              </button>
            </header>
            <form onSubmit={handleImportEmployeesForm} className="p-10 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Planilha (Excel ou CSV) *</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="file"
                      accept=".xlsx,.csv"
                      onChange={e => setImportFile(e.target.files?.[0] || null)}
                      required
                      className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-2xl file:border-0 file:text-sm file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer"
                    />
                  </div>
                </div>
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-start gap-3">
                    <FileSpreadsheet className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" size={20} />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-900 dark:text-white mb-2">Formato da Planilha</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                        Colunas obrigatórias: <strong>Nome</strong>, <strong>Email</strong>, <strong>Senha</strong>, <strong>Cargo</strong>
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Colunas opcionais: <strong>Departamento</strong>, <strong>Role</strong> (employee, supervisor, hr, admin)
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl font-bold text-sm transition-all"
                >
                  <Download size={18} /> Baixar Modelo de Planilha
                </button>
              </div>

              {importResult && (
                <div className="space-y-4">
                  <div className={`p-4 rounded-xl border ${importResult.errors.length === 0 ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                    <p className="text-sm font-bold text-slate-900 dark:text-white mb-2">
                      Importação concluída: {importResult.success} de {importResult.total} funcionários criados
                    </p>
                    {importResult.errors.length > 0 && (
                      <div className="mt-3 space-y-2 max-h-40 overflow-y-auto">
                        <p className="text-xs font-bold text-amber-600 dark:text-amber-400">Erros encontrados:</p>
                        {importResult.errors.slice(0, 10).map((err: any, idx: number) => (
                          <p key={idx} className="text-xs text-slate-600 dark:text-slate-400">
                            Linha {err.row} ({err.email}): {err.error}
                          </p>
                        ))}
                        {importResult.errors.length > 10 && (
                          <p className="text-xs text-slate-500 dark:text-slate-500">... e mais {importResult.errors.length - 10} erros</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-4 pt-4">
                <Button onClick={() => { setShowImportModal(false); setImportFile(null); setImportResult(null); }} type="button" variant="outline" className="flex-1 h-14">
                  Fechar
                </Button>
                <Button loading={isImporting} type="submit" disabled={!importFile} className="flex-2 h-14">
                  Importar Funcionários
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminView;
