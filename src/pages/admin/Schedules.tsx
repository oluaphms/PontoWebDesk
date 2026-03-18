import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Repeat, CalendarDays, X, UserPlus, Users } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type TabId = 'simples' | 'ciclicas' | 'mensais';

interface ScheduleRow {
  id: string;
  name: string;
  days: number[];
  shift_id: string | null;
  shift_name?: string;
}

interface CicloItem {
  id: string;
  shift_id: string;
  duracao_dias: number;
}

interface EscalaCiclicaRow {
  id: string;
  name: string;
  data_base: string;
  controlar_dsr: boolean;
  ciclo_dsr_index: number;
  ciclos: CicloItem[];
  employee_ids: string[];
}

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const AdminSchedules: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [tab, setTab] = useState<TabId>('simples');
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [shifts, setShifts] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; nome: string }[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Escalas simples
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', days: [] as number[], shift_id: '' });
  const [saving, setSaving] = useState(false);

  // Escalas cíclicas
  const [ciclicas, setCiclicas] = useState<EscalaCiclicaRow[]>([]);
  const [modalCiclicaOpen, setModalCiclicaOpen] = useState(false);
  const [editingCiclicaId, setEditingCiclicaId] = useState<string | null>(null);
  const [formCiclica, setFormCiclica] = useState({
    name: '',
    data_base: new Date().toISOString().slice(0, 10),
    controlar_dsr: false,
    ciclo_dsr_index: 0,
    ciclos: [] as CicloItem[],
    employee_ids: [] as string[],
  });
  const [pickerEmployeesOpen, setPickerEmployeesOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');

  // Escalas mensais
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [mensal, setMensal] = useState<{ employee_ids: string[]; shift_colors: Record<string, string>; grid: Record<string, string> } | null>(null);
  const [mensalShifts, setMensalShifts] = useState<{ shift_id: string; name: string; color: string }[]>([]);
  const [selectedShiftColor, setSelectedShiftColor] = useState<string | null>(null);
  const [mensalEmployees, setMensalEmployees] = useState<{ id: string; nome: string }[]>([]);
  const [addShiftModal, setAddShiftModal] = useState(false);
  const [addEmployeeMensalOpen, setAddEmployeeMensalOpen] = useState(false);
  const [copyMonthOpen, setCopyMonthOpen] = useState(false);
  const [copyTargetPeriod, setCopyTargetPeriod] = useState('');

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const [schedRows, shiftRows, userRows, ciclicasRows, mensalRow] = await Promise.all([
        db.select('schedules', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('work_shifts', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('escala_ciclica', [{ column: 'company_id', operator: 'eq', value: user.companyId }]).catch(() => []) as Promise<any[]>,
        db.select('escala_mensal', [{ column: 'company_id', operator: 'eq', value: user.companyId }, { column: 'period', operator: 'eq', value: period }]).catch(() => []) as Promise<any[]>,
      ]);
      const shiftMap = new Map((shiftRows ?? []).map((s: any) => [s.id, s.name]));
      setRows((schedRows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        days: Array.isArray(r.days) ? r.days : [],
        shift_id: r.shift_id,
        shift_name: r.shift_id ? shiftMap.get(r.shift_id) : undefined,
      })));
      setShifts((shiftRows ?? []).map((s: any) => ({ id: s.id, name: s.name })));
      setEmployees((userRows ?? []).filter((u: any) => u.role === 'employee' || u.role === 'hr' || u.role === 'admin').map((u: any) => ({ id: u.id, nome: u.nome || u.email || '' })));
      setCiclicas((ciclicasRows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        data_base: r.data_base || '',
        controlar_dsr: !!r.controlar_dsr,
        ciclo_dsr_index: r.ciclo_dsr_index ?? 0,
        ciclos: Array.isArray(r.ciclos) ? r.ciclos : [],
        employee_ids: Array.isArray(r.employee_ids) ? r.employee_ids : [],
      })));
      if (mensalRow && (mensalRow as any[]).length > 0) {
        const m = (mensalRow as any[])[0];
        setMensal({
          employee_ids: m.employee_ids || [],
          shift_colors: m.shift_colors || {},
          grid: m.grid || {},
        });
        const shiftColors = m.shift_colors || {};
        setMensalShifts(Object.entries(shiftColors).map(([shift_id, color]) => ({ shift_id, name: shiftMap.get(shift_id) || '', color: color as string })));
      } else {
        setMensal({ employee_ids: [], shift_colors: {}, grid: {} });
        setMensalShifts([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  useEffect(() => {
    if (tab === 'mensais') load();
  }, [tab, period]);

  const formatDays = (days: number[]) => DAYS.filter((_, i) => days.includes(i)).join(', ') || '—';

  // --- Escalas simples ---
  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', days: [], shift_id: '' });
    setModalOpen(true);
  };

  const openEdit = (row: ScheduleRow) => {
    setEditingId(row.id);
    setForm({ name: row.name, days: row.days || [], shift_id: row.shift_id || '' });
    setModalOpen(true);
  };

  const toggleDay = (d: number) => {
    setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() }));
  };

  const handleSave = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome da escala.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (editingId) {
        await db.update('schedules', editingId, { name: form.name.trim(), days: form.days, shift_id: form.shift_id || null });
        setMessage({ type: 'success', text: 'Escala atualizada com sucesso.' });
      } else {
        await db.insert('schedules', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          name: form.name.trim(),
          days: form.days,
          shift_id: form.shift_id || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Escala criada com sucesso.' });
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta escala?')) return;
    try {
      await db.delete('schedules', id);
      setMessage({ type: 'success', text: 'Escala excluída.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  // --- Escalas cíclicas ---
  const openCreateCiclica = () => {
    setEditingCiclicaId(null);
    setFormCiclica({
      name: '',
      data_base: new Date().toISOString().slice(0, 10),
      controlar_dsr: false,
      ciclo_dsr_index: 0,
      ciclos: [],
      employee_ids: [],
    });
    setModalCiclicaOpen(true);
  };

  const openEditCiclica = (row: EscalaCiclicaRow) => {
    setEditingCiclicaId(row.id);
    setFormCiclica({
      name: row.name,
      data_base: row.data_base,
      controlar_dsr: row.controlar_dsr,
      ciclo_dsr_index: row.ciclo_dsr_index,
      ciclos: row.ciclos.map((c) => ({ ...c, id: c.id || crypto.randomUUID() })),
      employee_ids: row.employee_ids || [],
    });
    setModalCiclicaOpen(true);
  };

  const addCiclo = () => {
    setFormCiclica((f) => ({
      ...f,
      ciclos: [...f.ciclos, { id: crypto.randomUUID(), shift_id: shifts[0]?.id || '', duracao_dias: 1 }],
    }));
  };

  const removeCiclo = (id: string) => {
    setFormCiclica((f) => ({ ...f, ciclos: f.ciclos.filter((c) => c.id !== id) }));
  };

  const updateCiclo = (id: string, upd: Partial<CicloItem>) => {
    setFormCiclica((f) => ({ ...f, ciclos: f.ciclos.map((c) => (c.id === id ? { ...c, ...upd } : c)) }));
  };

  const addEmployeeToCiclica = (empId: string) => {
    if (formCiclica.employee_ids.includes(empId)) return;
    setFormCiclica((f) => ({ ...f, employee_ids: [...f.employee_ids, empId] }));
  };

  const removeEmployeeFromCiclica = (empId: string) => {
    setFormCiclica((f) => ({ ...f, employee_ids: f.employee_ids.filter((id) => id !== empId) }));
  };

  const handleSaveCiclica = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    if (!formCiclica.name.trim()) {
      setMessage({ type: 'error', text: 'Informe a descrição da escala.' });
      return;
    }
    if (formCiclica.ciclos.length === 0) {
      setMessage({ type: 'error', text: 'Adicione ao menos um ciclo (horário + duração).' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        name: formCiclica.name.trim(),
        data_base: formCiclica.data_base,
        controlar_dsr: formCiclica.controlar_dsr,
        ciclo_dsr_index: formCiclica.ciclo_dsr_index,
        ciclos: formCiclica.ciclos.map(({ id, ...c }) => c),
        employee_ids: formCiclica.employee_ids,
        updated_at: new Date().toISOString(),
      };
      if (editingCiclicaId) {
        await db.update('escala_ciclica', editingCiclicaId, payload);
        setMessage({ type: 'success', text: 'Escala cíclica atualizada.' });
      } else {
        await db.insert('escala_ciclica', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          ...payload,
          created_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Escala cíclica criada.' });
      }
      setModalCiclicaOpen(false);
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCiclica = async (id: string) => {
    if (!confirm('Excluir esta escala cíclica?')) return;
    try {
      await db.delete('escala_ciclica', id);
      setMessage({ type: 'success', text: 'Escala cíclica excluída.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  const filteredEmployeesForPicker = employeeSearch.trim()
    ? employees.filter((e) => e.nome.toLowerCase().includes(employeeSearch.trim().toLowerCase()))
    : employees;

  // --- Escalas mensais ---
  const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
  const [year, month] = period.split('-').map(Number);
  const numDays = daysInMonth(year, month);

  const loadMensalEmployees = () => {
    if (!mensal?.employee_ids.length) return [];
    return mensal.employee_ids.map((id) => ({ id, nome: employees.find((e) => e.id === id)?.nome || id }));
  };

  const mensalEmployeeList = loadMensalEmployees();

  const setGridCell = (employeeId: string, day: number, shiftId: string | null) => {
    const key = `${employeeId}-${day}`;
    setMensal((prev) => {
      if (!prev) return prev;
      const next = { ...prev, grid: { ...prev.grid } };
      if (shiftId) next.grid[key] = shiftId;
      else delete next.grid[key];
      return next;
    });
  };

  const getGridCell = (employeeId: string, day: number): string | undefined => {
    return mensal?.grid[`${employeeId}-${day}`];
  };

  const saveMensal = async () => {
    if (!user?.companyId || !isSupabaseConfigured || !mensal) return;
    setSaving(true);
    setMessage(null);
    try {
      const shiftColorsObj: Record<string, string> = {};
      mensalShifts.forEach((s) => { shiftColorsObj[s.shift_id] = s.color; });
      const payload = {
        period,
        employee_ids: mensal.employee_ids,
        shift_colors: shiftColorsObj,
        grid: mensal.grid,
        updated_at: new Date().toISOString(),
      };
      const existing = await db.select('escala_mensal', [{ column: 'company_id', operator: 'eq', value: user.companyId }, { column: 'period', operator: 'eq', value: period }]) as any[];
      if (existing?.length > 0) {
        await db.update('escala_mensal', existing[0].id, payload);
        setMessage({ type: 'success', text: 'Escala mensal salva.' });
      } else {
        await db.insert('escala_mensal', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          ...payload,
          created_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Escala mensal salva.' });
      }
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const addShiftToMensal = (shiftId: string, color: string) => {
    const name = shifts.find((s) => s.id === shiftId)?.name || '';
    if (mensalShifts.some((s) => s.shift_id === shiftId)) return;
    setMensalShifts((prev) => [...prev, { shift_id: shiftId, name, color }]);
    setAddShiftModal(false);
  };

  const removeShiftFromMensal = (shiftId: string) => {
    setMensalShifts((prev) => prev.filter((s) => s.shift_id !== shiftId));
  };

  const addEmployeeToMensal = (empId: string) => {
    if (!mensal) return;
    if (mensal.employee_ids.includes(empId)) return;
    setMensal((prev) => prev ? { ...prev, employee_ids: [...prev.employee_ids, empId] } : prev);
    setAddEmployeeMensalOpen(false);
  };

  const removeEmployeeFromMensal = (empId: string) => {
    setMensal((prev) => {
      if (!prev) return prev;
      const next = { ...prev, employee_ids: prev.employee_ids.filter((id) => id !== empId), grid: { ...prev.grid } };
      Object.keys(next.grid).forEach((k) => { if (k.startsWith(empId + '-')) delete next.grid[k]; });
      return next;
    });
  };

  const copyToMonth = async () => {
    if (!copyTargetPeriod || !user?.companyId || !mensal || !isSupabaseConfigured) return;
    setSaving(true);
    setMessage(null);
    try {
      const shiftColorsObj: Record<string, string> = {};
      mensalShifts.forEach((s) => { shiftColorsObj[s.shift_id] = s.color; });
      await db.insert('escala_mensal', {
        id: crypto.randomUUID(),
        company_id: user.companyId,
        period: copyTargetPeriod,
        employee_ids: mensal.employee_ids,
        shift_colors: shiftColorsObj,
        grid: { ...mensal.grid },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setMessage({ type: 'success', text: `Escala copiada para ${copyTargetPeriod}.` });
      setCopyMonthOpen(false);
      setPeriod(copyTargetPeriod);
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao copiar.' });
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';

  if (loading || !user) return <LoadingState message="Carregando..." />;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm`}>
          {message.text}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Escalas" />
      </div>

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setTab('simples')}
          className={`px-4 py-2 rounded-t-xl font-medium text-sm ${tab === 'simples' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
        >
          Escalas
        </button>
        <button
          type="button"
          onClick={() => setTab('ciclicas')}
          className={`px-4 py-2 rounded-t-xl font-medium text-sm flex items-center gap-1.5 ${tab === 'ciclicas' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
        >
          <Repeat className="w-4 h-4" /> Escalas Cíclicas
        </button>
        <button
          type="button"
          onClick={() => setTab('mensais')}
          className={`px-4 py-2 rounded-t-xl font-medium text-sm flex items-center gap-1.5 ${tab === 'mensais' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
        >
          <CalendarDays className="w-4 h-4" /> Escalas Mensais
        </button>
      </div>

      {tab === 'simples' && (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
              <Plus className="w-5 h-5" /> Criar Escala
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            {loadingData ? (
              <div className="p-12 text-center text-slate-500">Carregando...</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nome</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Dias da semana</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horário</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDays(row.days)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.shift_name || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg"><Pencil className="w-4 h-4" /></button>
                        <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loadingData && rows.length === 0 && <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhuma escala cadastrada.</p>}
          </div>
        </>
      )}

      {tab === 'ciclicas' && (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={openCreateCiclica} className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
              <Plus className="w-5 h-5" /> Incluir
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            {loadingData ? (
              <div className="p-12 text-center text-slate-500">Carregando...</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data Base</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ciclos</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {ciclicas.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.data_base}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.ciclos.length} ciclo(s)</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => openEditCiclica(row)} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg"><Pencil className="w-4 h-4" /></button>
                        <button type="button" onClick={() => handleDeleteCiclica(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loadingData && ciclicas.length === 0 && <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhuma escala cíclica. Clique em Incluir.</p>}
          </div>
        </>
      )}

      {tab === 'mensais' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Período</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass} style={{ width: '160px' }} />
            <button type="button" onClick={saveMensal} disabled={saving} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Salvar</button>
            <button type="button" onClick={() => setCopyMonthOpen(true)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium">Copiar para outro mês</button>
            <button type="button" onClick={() => setAddEmployeeMensalOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium"><UserPlus className="w-4 h-4" /> Adicionar funcionário</button>
            <button type="button" onClick={() => setAddShiftModal(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium"><Plus className="w-4 h-4" /> Incluir horário</button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-slate-600 dark:text-slate-400">Horários na escala:</span>
            {mensalShifts.map((s) => (
              <span key={s.shift_id} className="inline-flex items-center gap-2 px-2 py-1 rounded-lg text-sm" style={{ backgroundColor: s.color + '20', color: s.color }}>
                <span className="w-4 h-4 rounded border border-slate-300" style={{ backgroundColor: s.color }} />
                {s.name}
                <button type="button" onClick={() => setSelectedShiftColor(s.shift_id)} title="Pintar com este horário" className="text-xs font-medium">Usar</button>
                <button type="button" onClick={() => removeShiftFromMensal(s.shift_id)} className="text-slate-500 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </span>
            ))}
            {selectedShiftColor && <span className="text-xs text-slate-500">Clique em uma célula da grade para pintar com o horário selecionado.</span>}
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto">
            {mensalEmployeeList.length === 0 ? (
              <p className="p-8 text-center text-slate-500 dark:text-slate-400">Adicione funcionários e horários, depois pinte os dias na grade.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50">
                    <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400 border-b border-r border-slate-200 dark:border-slate-700 sticky left-0 bg-slate-50 dark:bg-slate-800/50 min-w-[120px]">Funcionário</th>
                    {Array.from({ length: numDays }, (_, i) => i + 1).map((d) => (
                      <th key={d} className="px-1 py-1 text-center font-medium text-slate-500 dark:text-slate-400 border-b border-r border-slate-200 dark:border-slate-700 w-8">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mensalEmployeeList.map((emp) => (
                    <tr key={emp.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1 border-r border-slate-200 dark:border-slate-700 sticky left-0 bg-white dark:bg-slate-900/50 font-medium text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="truncate">{emp.nome}</span>
                          <button type="button" onClick={() => removeEmployeeFromMensal(emp.id)} className="text-slate-400 hover:text-red-600 shrink-0" title="Remover"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                      {Array.from({ length: numDays }, (_, i) => i + 1).map((day) => {
                        const shiftId = getGridCell(emp.id, day);
                        const shiftInfo = mensalShifts.find((s) => s.shift_id === shiftId);
                        return (
                          <td
                            key={day}
                            className="w-8 h-8 p-0 border-r border-slate-100 dark:border-slate-800 cursor-pointer hover:ring-2 hover:ring-indigo-400"
                            style={{ backgroundColor: shiftInfo?.color || 'transparent', minWidth: 28 }}
                            onClick={() => {
                              if (selectedShiftColor) setGridCell(emp.id, day, selectedShiftColor);
                              else setGridCell(emp.id, day, shiftId ? undefined : null);
                            }}
                            title={shiftInfo?.name || 'Em branco'}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Modal Escala simples */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Escala' : 'Criar Escala'}</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="Ex: Comercial" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Dias da semana</label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((label, i) => (
                  <button key={i} type="button" onClick={() => toggleDay(i)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${form.days.includes(i) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Horário</label>
              <select value={form.shift_id} onChange={(e) => setForm({ ...form, shift_id: e.target.value })} className={inputClass}>
                <option value="">Nenhum</option>
                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Escala Cíclica */}
      {modalCiclicaOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto" role="dialog" aria-modal="true" onClick={() => !saving && setModalCiclicaOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl my-8 p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingCiclicaId ? 'Editar Escala Cíclica' : 'Incluir Escala Cíclica'}</h3>

            <section>
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Descrição de Identificação</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Descrição</label>
                  <input type="text" value={formCiclica.name} onChange={(e) => setFormCiclica({ ...formCiclica, name: e.target.value })} className={inputClass} placeholder="Descrição da escala" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Data Base</label>
                  <input type="date" value={formCiclica.data_base} onChange={(e) => setFormCiclica({ ...formCiclica, data_base: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="flex items-center gap-2 mt-6">
                    <input type="checkbox" checked={formCiclica.controlar_dsr} onChange={(e) => setFormCiclica({ ...formCiclica, controlar_dsr: e.target.checked })} />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Controlar DSR pela escala</span>
                  </label>
                  {formCiclica.controlar_dsr && formCiclica.ciclos.length > 0 && (
                    <div className="mt-2">
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Ciclo de DSR</label>
                      <select value={formCiclica.ciclo_dsr_index} onChange={(e) => setFormCiclica({ ...formCiclica, ciclo_dsr_index: Number(e.target.value) })} className={inputClass}>
                        {formCiclica.ciclos.map((_, i) => (
                          <option key={i} value={i}>Ciclo {i + 1}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section>
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Configuração da Escala</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Ciclos são os horários que se repetem. Duração = dias de cada ciclo.</p>
              {formCiclica.ciclos.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100 dark:border-slate-800">
                  <select value={c.shift_id} onChange={(e) => updateCiclo(c.id, { shift_id: e.target.value })} className="flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm">
                    {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <label className="text-sm text-slate-600 dark:text-slate-400">Duração (dias)</label>
                  <input type="number" min={1} value={c.duracao_dias} onChange={(e) => updateCiclo(c.id, { duracao_dias: Number(e.target.value) })} className="w-20 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm" />
                  <button type="button" onClick={() => removeCiclo(c.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Remover ciclo"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" onClick={addCiclo} className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium">
                <Plus className="w-4 h-4" /> Adicionar ciclo (Horário)
              </button>
            </section>

            <section>
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Funcionários da Escala</h4>
              <div className="flex flex-wrap gap-2 mb-2">
                {formCiclica.employee_ids.map((id) => {
                  const emp = employees.find((e) => e.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm">
                      {emp?.nome || id}
                      <button type="button" onClick={() => removeEmployeeFromCiclica(id)} className="text-slate-500 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                    </span>
                  );
                })}
              </div>
              <button type="button" onClick={() => setPickerEmployeesOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium">
                <Users className="w-4 h-4" /> Adicionar funcionários
              </button>
            </section>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setModalCiclicaOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
              <button type="button" onClick={handleSaveCiclica} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Concluir</button>
            </div>
          </div>
        </div>
      )}

      {/* Picker funcionários (escala cíclica) */}
      {pickerEmployeesOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h4 className="font-semibold text-slate-900 dark:text-white">Localizar funcionário</h4>
              <button type="button" onClick={() => setPickerEmployeesOpen(false)} className="p-2 text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-2">
              <input type="text" value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} placeholder="Buscar por nome..." className={inputClass} />
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {filteredEmployeesForPicker.map((emp) => (
                <li key={emp.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <span className="text-slate-800 dark:text-slate-200">{emp.nome}</span>
                  <button type="button" onClick={() => { addEmployeeToCiclica(emp.id); }} className="text-indigo-600 dark:text-indigo-400 text-sm font-medium">Retornar</button>
                </li>
              ))}
            </ul>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setPickerEmployeesOpen(false)} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-medium">Concluir</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal incluir horário (escala mensal) */}
      {addShiftModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-sm p-6 space-y-4">
            <h4 className="font-semibold text-slate-900 dark:text-white">Selecione o horário e uma cor</h4>
            {shifts.filter((s) => !mensalShifts.some((ms) => ms.shift_id === s.id)).length === 0 ? (
              <p className="text-sm text-slate-500">Todos os horários já foram incluídos ou não há horários cadastrados.</p>
            ) : (
              <ul className="space-y-2">
                {shifts.filter((s) => !mensalShifts.some((ms) => ms.shift_id === s.id)).map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="flex-1 text-slate-800 dark:text-slate-200">{s.name}</span>
                    <div className="flex gap-1">
                      {DEFAULT_COLORS.slice(0, 6).map((color) => (
                        <button key={color} type="button" onClick={() => addShiftToMensal(s.id, color)} className="w-6 h-6 rounded border border-slate-300" style={{ backgroundColor: color }} title={color} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => setAddShiftModal(false)} className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Fechar</button>
          </div>
        </div>
      )}

      {/* Modal adicionar funcionário (escala mensal) */}
      {addEmployeeMensalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[70vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between">
              <h4 className="font-semibold text-slate-900 dark:text-white">Adicionar funcionário</h4>
              <button type="button" onClick={() => setAddEmployeeMensalOpen(false)} className="p-2 text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {employees.filter((e) => !mensal?.employee_ids.includes(e.id)).map((emp) => (
                <li key={emp.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <span className="text-slate-800 dark:text-slate-200">{emp.nome}</span>
                  <button type="button" onClick={() => addEmployeeToMensal(emp.id)} className="text-indigo-600 dark:text-indigo-400 text-sm font-medium">Adicionar</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Modal copiar para outro mês */}
      {copyMonthOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-sm p-6 space-y-4">
            <h4 className="font-semibold text-slate-900 dark:text-white">Copiar escala para outro mês</h4>
            <input type="month" value={copyTargetPeriod} onChange={(e) => setCopyTargetPeriod(e.target.value)} className={inputClass} />
            <div className="flex gap-2">
              <button type="button" onClick={() => setCopyMonthOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
              <button type="button" onClick={copyToMonth} disabled={saving || !copyTargetPeriod} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Copiar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSchedules;
