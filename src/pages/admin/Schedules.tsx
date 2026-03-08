import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface ScheduleRow {
  id: string;
  name: string;
  days: number[];
  shift_id: string | null;
  shift_name?: string;
}

const AdminSchedules: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [shifts, setShifts] = useState<{ id: string; name: string }[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', days: [] as number[], shift_id: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const shiftFilters = user.companyId ? [{ column: 'company_id', operator: 'eq', value: user.companyId }] : undefined;
      const [schedRows, shiftRows] = await Promise.all([
        db.select('schedules', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('work_shifts', shiftFilters) as Promise<any[]>,
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
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

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
        await db.update('schedules', editingId, {
          name: form.name.trim(),
          days: form.days,
          shift_id: form.shift_id || null,
        });
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

  const formatDays = (days: number[]) => DAYS.filter((_, i) => days.includes(i)).join(', ') || '—';

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
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nome da escala</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Dias da semana</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horário vinculado</th>
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
        {!loadingData && rows.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhuma escala cadastrada.</p>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Escala' : 'Criar Escala'}</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Ex: Comercial" />
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
              {shifts.length === 0 && (
                <p className="text-amber-600 dark:text-amber-400 text-sm mb-2">Crie um horário em Horários primeiro.</p>
              )}
              <select value={form.shift_id} onChange={(e) => setForm({ ...form, shift_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                <option value="">Nenhum</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSchedules;
