import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Copy } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';

interface ShiftRow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_duration: number;
  tolerance_minutes: number;
}

const AdminShifts: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    start_time: '08:00',
    end_time: '17:00',
    break_duration: 60,
    tolerance_minutes: 15,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    if (!isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const filters = user?.companyId
        ? [{ column: 'company_id', operator: 'eq', value: user.companyId }]
        : undefined;
      const data = (await db.select('work_shifts', filters)) as any[];
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          start_time: r.start_time ?? '08:00',
          end_time: r.end_time ?? '17:00',
          break_duration: r.break_duration ?? 0,
          tolerance_minutes: r.tolerance_minutes ?? 0,
        }))
      );
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const toTimeStr = (v: string) => (v && v.length >= 5 ? v.slice(0, 5) : '—');

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', start_time: '08:00', end_time: '17:00', break_duration: 60, tolerance_minutes: 15 });
    setModalOpen(true);
  };

  const openEdit = (row: ShiftRow) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      start_time: toTimeStr(row.start_time),
      end_time: toTimeStr(row.end_time),
      break_duration: row.break_duration ?? 0,
      tolerance_minutes: row.tolerance_minutes ?? 0,
    });
    setModalOpen(true);
  };

  const openDuplicate = (row: ShiftRow) => {
    setEditingId(null);
    setForm({
      name: `${row.name} (cópia)`,
      start_time: toTimeStr(row.start_time),
      end_time: toTimeStr(row.end_time),
      break_duration: row.break_duration ?? 0,
      tolerance_minutes: row.tolerance_minutes ?? 0,
    });
    setModalOpen(true);
  };

  const timeToMinutes = (t: string) => {
    if (!t || t.length < 5) return 0;
    const [h, m] = t.slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  };

  const handleSave = async () => {
    if (!isSupabaseConfigured) return;
    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Informe o nome do horário.' });
      return;
    }
    const startMin = timeToMinutes(form.start_time);
    const endMin = timeToMinutes(form.end_time);
    if (endMin <= startMin) {
      setMessage({ type: 'error', text: 'A saída deve ser após a entrada.' });
      return;
    }
    const durationMin = endMin - startMin;
    if (form.break_duration >= durationMin) {
      setMessage({ type: 'error', text: 'O intervalo deve ser menor que a jornada (entrada até saída).' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        name: form.name.trim(),
        start_time: form.start_time,
        end_time: form.end_time,
        break_duration: form.break_duration,
        tolerance_minutes: form.tolerance_minutes,
      };
      if (editingId) {
        await db.update('work_shifts', editingId, payload);
        setMessage({ type: 'success', text: 'Horário atualizado com sucesso.' });
      } else {
        await db.insert('work_shifts', {
          id: crypto.randomUUID(),
          company_id: user?.companyId || null,
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Horário criado com sucesso.' });
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
    if (!confirm('Excluir este horário?')) return;
    try {
      await db.delete('work_shifts', id);
      setMessage({ type: 'success', text: 'Horário excluído.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  if (loading || !user) return <LoadingState message="Carregando..." />;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm`}>
          {message.text}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Horários" />
        <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
          <Plus className="w-5 h-5" /> Criar Horário
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
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Entrada</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Saída</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Intervalo (min)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Tolerância (min)</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.name}</td>
                  <td className="px-4 py-3 tabular-nums">{toTimeStr(row.start_time)}</td>
                  <td className="px-4 py-3 tabular-nums">{toTimeStr(row.end_time)}</td>
                  <td className="px-4 py-3">{row.break_duration ?? 0}</td>
                  <td className="px-4 py-3">{row.tolerance_minutes ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openDuplicate(row)} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg" title="Duplicar"><Copy className="w-4 h-4" /></button>
                    <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg"><Pencil className="w-4 h-4" /></button>
                    <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loadingData && rows.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum horário cadastrado.</p>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Horário' : 'Criar Horário'}</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Ex: Comercial 8h" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Entrada</label>
                <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Saída</label>
                <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Intervalo (min)</label>
                <input type="number" min={0} value={form.break_duration} onChange={(e) => setForm({ ...form, break_duration: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tolerância (min)</label>
                <input type="number" min={0} value={form.tolerance_minutes} onChange={(e) => setForm({ ...form, tolerance_minutes: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              </div>
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

export default AdminShifts;
