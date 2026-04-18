import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useToast } from '../../components/ToastProvider';
import PageHeader from '../../components/PageHeader';
import { LoadingState, Button } from '../../../components/UI';
import { Plus, FileDown } from 'lucide-react';
import { AddTimeRecordModal } from '../../components/AddTimeRecordModal';
import { ManualRecordModal } from '../../components/ManualRecordModal';
import { buildDayMirrorSummary, DayMirror, isManualRecord, formatMinutes, getDayStatus } from '../../utils/timesheetMirror';
import { EditTimeRecordModal } from '../../components/EditTimeRecordModal';

interface Employee {
  id: string;
  nome: string;
  department_id?: string;
}

interface Department {
  id: string;
  name: string;
}

type TimeRecord = {
  id: string;
  user_id: string;
  created_at: string;
  type: 'entrada' | 'saida' | 'intervalo_saida' | 'intervalo_volta';
  manual_reason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_manual?: boolean;
};

const AdminTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [filterDepartmentId, setFilterDepartmentId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState(() => 
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  );
  const [periodEnd, setPeriodEnd] = useState(() => 
    new Date().toISOString().slice(0, 10)
  );
  
  // Modais
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedManualRecord, setSelectedManualRecord] = useState<TimeRecord | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [recordToEdit, setRecordToEdit] = useState<TimeRecord | null>(null);
  
  // Carrega funcionários e departamentos
  useEffect(() => {
    if (!user?.company_id || !isSupabaseConfigured) {
      setLoadingEmployees(false);
      return;
    }

    const loadData = async () => {
      setLoadingEmployees(true);
      try {
        // Carrega funcionários
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, nome, department_id')
          .eq('company_id', user.company_id)
          .eq('role', 'employee');
        
        if (usersError) throw usersError;
        setEmployees(users || []);
        
        // Carrega departamentos
        const { data: depts, error: deptsError } = await supabase
          .from('departments')
          .select('id, name')
          .eq('company_id', user.company_id);
        
        if (deptsError) throw deptsError;
        setDepartments(depts || []);
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
        toast.addToast('error', 'Erro ao carregar funcionários');
      } finally {
        setLoadingEmployees(false);
      }
    };

    loadData();
  }, [user?.company_id, toast]);
  
  // Carrega registros de ponto
  const loadRecords = useCallback(async () => {
    if (!user?.company_id || !isSupabaseConfigured) return;
    
    setLoadingData(true);
    try {
      let query = supabase
        .from('time_records')
        .select('*')
        .eq('company_id', user.company_id)
        .gte('created_at', `${periodStart}T00:00:00`)
        .lte('created_at', `${periodEnd}T23:59:59`)
        .order('created_at', { ascending: true });
      
      if (filterUserId) {
        query = query.eq('user_id', filterUserId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      setRecords(data || []);
    } catch (error) {
      console.error('Erro ao carregar registros:', error);
      toast.addToast('error', 'Erro ao carregar registros de ponto');
    } finally {
      setLoadingData(false);
    }
  }, [user?.company_id, periodStart, periodEnd, filterUserId, toast]);
  
  useEffect(() => {
    loadRecords();
  }, [loadRecords]);
  
  // Agrupa registros por funcionário e data
  const timesheetData = useMemo(() => {
    const byEmployee = new Map<string, Map<string, DayMirror>>();
    
    // Agrupa registros por funcionário
    const employeeRecords = new Map<string, TimeRecord[]>();
    for (const record of records) {
      if (!employeeRecords.has(record.user_id)) {
        employeeRecords.set(record.user_id, []);
      }
      employeeRecords.get(record.user_id)!.push(record);
    }
    
    // Constrói espelho para cada funcionário
    for (const [userId, userRecords] of employeeRecords) {
      const mirror = buildDayMirrorSummary(userRecords, periodStart, periodEnd);
      byEmployee.set(userId, mirror);
    }
    
    return byEmployee;
  }, [records, periodStart, periodEnd]);
  
  // Filtra funcionários
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      if (filterDepartmentId && emp.department_id !== filterDepartmentId) return false;
      return true;
    });
  }, [employees, filterDepartmentId]);
  
  // Gera datas do período
  const periodDates = useMemo(() => {
    const dates: string[] = [];
    const start = new Date(periodStart + 'T00:00:00');
    const end = new Date(periodEnd + 'T00:00:00');
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, [periodStart, periodEnd]);
  
  // Formata data para exibição (sem problemas de fuso)
  const formatDateBR = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };
  
  // Adiciona nova batida
  const handleAddRecord = async (data: {
    user_id: string;
    created_at: string;
    type: string;
    manual_reason?: string;
    latitude?: number;
    longitude?: number;
  }) => {
    if (!user?.company_id) return;
    
    try {
      const { error } = await supabase.from('time_records').insert({
        ...data,
        company_id: user.company_id,
        is_manual: true,
      });
      
      if (error) throw error;
      
      toast.addToast('success', 'Batida adicionada com sucesso');
      setShowAddModal(false);
      loadRecords();
    } catch (error) {
      console.error('Erro ao adicionar batida:', error);
      toast.addToast('error', 'Erro ao adicionar batida');
    }
  };
  
  // Exporta para CSV
  const handleExportCSV = () => {
    const rows: string[] = [];
    rows.push('Data,Funcionário,Entrada,Saída Intervalo,Volta Intervalo,Saída Final,Horas Trabalhadas');
    
    for (const emp of filteredEmployees) {
      const empMirror = timesheetData.get(emp.id);
      if (!empMirror) continue;
      
      for (const date of periodDates) {
        const day = empMirror.get(date);
        if (!day) continue;
        
        rows.push([
          date,
          emp.nome,
          day.entradaInicio || '-',
          day.saidaIntervalo || '-',
          day.voltaIntervalo || '-',
          day.saidaFinal || '-',
          formatMinutes(day.workedMinutes),
        ].join(','));
      }
    }
    
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `espelho-ponto-${periodStart}-${periodEnd}.csv`;
    link.click();
  };
  
  // Renderiza badge de status do dia
  const renderDayStatus = (day: DayMirror) => {
    const { label, color } = getDayStatus(day);
    
    if (!label) return null;
    
    const colorClasses: Record<string, string> = {
      green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-300',
      red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-300',
      orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-300',
      purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-300',
      indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 border-indigo-300',
    };
    
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${colorClasses[color] || colorClasses.red}`}>
        {label}
      </span>
    );
  };
  
  // Renderiza célula de horário (azul com * se manual)
  const renderTimeCell = (time: string | null, record?: TimeRecord) => {
    const isManual = record && isManualRecord(record);
    
    return (
      <span 
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium cursor-pointer
          ${isManual 
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300 dark:border-blue-700' 
            : 'text-slate-700 dark:text-slate-300'
          }`}
        onClick={() => {
          if (isManual && record) {
            setSelectedManualRecord(record);
            setShowManualModal(true);
          } else if (record) {
            setRecordToEdit(record);
            setShowEditModal(true);
          }
        }}
        title={isManual ? `Batida manual: ${record?.manual_reason || 'Sem motivo'}` : 'Clique para editar'}
      >
        {time || '—'}
        {isManual && <span className="text-blue-500 font-bold">*</span>}
      </span>
    );
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'admin' && user.role !== 'hr') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Espelho de Ponto" />
      
      {/* Filtros */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex flex-wrap gap-4 items-end">
        <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Período Inicial
            </label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              />
            </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Período Final
            </label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              />
            </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Funcionário
            </label>
            <select
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              disabled={loadingEmployees}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm min-w-[200px]"
            >
              <option value="">
                {loadingEmployees ? 'Carregando...' : 'Selecione o colaborador'}
              </option>
              {filteredEmployees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Departamento
            </label>
            <select
              value={filterDepartmentId}
              onChange={(e) => {
                setFilterDepartmentId(e.target.value);
                setFilterUserId(''); // Limpa usuário quando muda departamento
              }}
              disabled={loadingEmployees}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm min-w-[150px]"
            >
              <option value="">{loadingEmployees ? 'Carregando...' : 'Todos'}</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => filterUserId && loadRecords()}
              disabled={!filterUserId || loadingData}
              className="flex items-center gap-2"
            >
              {loadingData ? 'Buscando...' : 'Buscar'}
            </Button>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={!filterUserId || records.length === 0}
              className="flex items-center gap-2"
            >
              <FileDown className="w-4 h-4" />
              Exportar CSV
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Adicionar Batida
            </Button>
          </div>
          </div>
        </div>

      {/* Legenda */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-500"></span>
          <span className="text-slate-600 dark:text-slate-400">
            Batida manual (com *)
          </span>
            </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full border border-slate-400"></span>
          <span className="text-slate-600 dark:text-slate-400">
            Batida normal
          </span>
          </div>
        </div>

      {/* Tabela */}
      {!filterUserId ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-slate-500 dark:text-slate-400">
            {loadingEmployees ? 'Carregando funcionários...' : 'Selecione um funcionário para visualizar o espelho de ponto'}
          </p>
        </div>
      ) : loadingData ? (
        <LoadingState message="Carregando espelho..." />
      ) : (
        <div className="space-y-6">
          {filteredEmployees.filter(emp => emp.id === filterUserId).map(employee => {
            const empMirror = timesheetData.get(employee.id);
            if (!empMirror) return null;
            
            return (
              <div key={employee.id} className="glass-card rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <h3 className="font-semibold text-slate-900 dark:text-white">
                    {employee.nome}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {departments.find(d => d.id === employee.department_id)?.name || 'Sem departamento'}
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Data</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Entrada</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Saída Int.</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Volta Int.</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Saída</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {periodDates.map(date => {
                        const day = empMirror.get(date);
                        if (!day) return null;
                        
                        // Encontra o registro correspondente a cada horário
                        const entradaRecord = day.records.find(r => 
                          new Date(r.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit', hour12:false}) === day.entradaInicio
                        );
                        const saidaIntRecord = day.records.find(r => 
                          new Date(r.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit', hour12:false}) === day.saidaIntervalo
                        );
                        const voltaIntRecord = day.records.find(r => 
                          new Date(r.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit', hour12:false}) === day.voltaIntervalo
                        );
                        const saidaRecord = day.records.find(r => 
                          new Date(r.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit', hour12:false}) === day.saidaFinal
                        );
                        
                        return (
                          <tr key={date} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                              {formatDateBR(date)}
                            </td>
                            <td className="px-3 py-2">
                              {renderDayStatus(day)}
                            </td>
                            <td className="px-3 py-2">
                              {renderTimeCell(day.entradaInicio, entradaRecord)}
                            </td>
                            <td className="px-3 py-2">
                              {renderTimeCell(day.saidaIntervalo, saidaIntRecord)}
                            </td>
                            <td className="px-3 py-2">
                              {renderTimeCell(day.voltaIntervalo, voltaIntRecord)}
                            </td>
                            <td className="px-3 py-2">
                              {renderTimeCell(day.saidaFinal, saidaRecord)}
                            </td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">
                              {formatMinutes(day.workedMinutes)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modais */}
      <AddTimeRecordModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddRecord}
        employees={employees}
        companyId={user?.company_id}
      />

      <ManualRecordModal
        isOpen={showManualModal}
        onClose={() => {
          setShowManualModal(false);
          setSelectedManualRecord(null);
        }}
        reason={selectedManualRecord?.manual_reason || ''}
        timestamp={selectedManualRecord?.created_at}
        type={selectedManualRecord?.type}
      />

      <EditTimeRecordModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setRecordToEdit(null);
        }}
        record={recordToEdit}
        onSave={() => {
          setShowEditModal(false);
          setRecordToEdit(null);
          loadRecords();
        }}
      />
    </div>
  );
};

export default AdminTimesheet;
