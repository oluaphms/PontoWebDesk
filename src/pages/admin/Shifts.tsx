import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import type { WeeklyScheduleDay, DayScheduleType, DSRConfig, ExtrasConfig, TipoMarcacaoConfig } from '../../../types';

const DAY_LABELS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

function timeToMinutes(t: string): number {
  if (!t || t.length < 5) return 0;
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computeCargaHoraria(day: WeeklyScheduleDay): string {
  if (day.dayType !== 'normal') return '00:00';
  const e1 = timeToMinutes(day.entrada1);
  const s1 = timeToMinutes(day.saida1);
  const e2 = timeToMinutes(day.entrada2);
  const s2 = timeToMinutes(day.saida2);
  const e3 = timeToMinutes(day.entrada3);
  const s3 = timeToMinutes(day.saida3);
  let total = 0;
  if (s1 > e1) total += s1 - e1;
  if (s2 > e2) total += s2 - e2;
  if (s3 > e3) total += s3 - e3;
  return minutesToHHmm(total);
}

function createEmptyDay(dayIndex: number): WeeklyScheduleDay {
  return {
    dayIndex,
    dayType: 'normal',
    entrada1: '08:00',
    saida1: '12:00',
    entrada2: '13:00',
    saida2: '17:00',
    entrada3: '',
    saida3: '',
    toleranciaExtras: 10,
    toleranciaFaltas: 10,
    cargaHoraria: '08:00',
  };
}

function createDefaultWeeklySchedule(): WeeklyScheduleDay[] {
  return DAY_LABELS.map((_, i) => {
    const d = createEmptyDay(i);
    d.cargaHoraria = computeCargaHoraria(d);
    return d;
  });
}

interface ShiftRow {
  id: string;
  number: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  break_start_time: string | null;
  break_end_time: string | null;
  break_duration: number;
  tolerance_minutes: number;
  /** Tipo de jornada (modelo de trabalho) */
  shift_type: 'fixed' | 'flexible' | '6x1' | '5x2' | '12x36' | '24x72' | 'custom';
  /** Intervalo mínimo/automático em minutos (Portaria 671) */
  break_minutes: number;
  config?: {
    weekly_schedule?: WeeklyScheduleDay[];
    dsr?: DSRConfig;
    extras?: ExtrasConfig;
    tipoMarcacao?: TipoMarcacaoConfig;
  };
}

const AdminShifts: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    number: '',
    description: '',
    name: '',
    start_time: '08:00',
    break_start_time: '12:00',
    break_end_time: '13:00',
    end_time: '17:00',
    tolerance_minutes: 15,
    shift_type: 'fixed' as ShiftRow['shift_type'],
    intervalo_auto_minutos: 60,
    weeklySchedule: createDefaultWeeklySchedule(),
    dsr: { tipo: 'automatico' as const } as DSRConfig,
    extras: { acumular: 'independentes' as const, controleHoras: 'diario' as const, numeroFaixas: 3 } as ExtrasConfig,
    tipoMarcacao: { tipo: 'normal' as const } as TipoMarcacaoConfig,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [opcoesOpen, setOpcoesOpen] = useState({ descanso: false, extras: false, tipo: false });

  const toTimeStr = (v: string) => (v && v.length >= 5 ? v.slice(0, 5) : '—');

  const load = async () => {
    if (!isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const filters = user?.companyId ? [{ column: 'company_id', operator: 'eq', value: user.companyId }] : undefined;
      const data = (await db.select('work_shifts', filters)) as any[];
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          number: r.number ?? '',
          name: r.name ?? '',
          description: r.description ?? r.name ?? '',
          start_time: toTimeStr(r.start_time ?? '08:00'),
          end_time: toTimeStr(r.end_time ?? '17:00'),
          break_start_time: r.break_start_time ? toTimeStr(r.break_start_time) : null,
          break_end_time: r.break_end_time ? toTimeStr(r.break_end_time) : null,
          break_duration: r.break_duration ?? r.break_minutes ?? 60,
          tolerance_minutes: r.tolerance_minutes ?? 0,
          shift_type: (r.shift_type as ShiftRow['shift_type']) || 'fixed',
          break_minutes: r.break_minutes ?? r.break_duration ?? 60,
          config: r.config ?? {},
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

  const openCreate = () => {
    setEditingId(null);
    const ws = createDefaultWeeklySchedule();
    setForm({
      number: '',
      description: '',
      name: '',
      start_time: '08:00',
      break_start_time: '12:00',
      break_end_time: '13:00',
      end_time: '17:00',
      tolerance_minutes: 15,
      shift_type: 'fixed',
      intervalo_auto_minutos: 60,
      weeklySchedule: ws,
      dsr: { tipo: 'automatico' },
      extras: { acumular: 'independentes', controleHoras: 'diario', numeroFaixas: 3 },
      tipoMarcacao: { tipo: 'normal' },
    });
    setModalOpen(true);
  };

  const openEdit = (row: ShiftRow) => {
    setEditingId(row.id);
    const ws = (row.config?.weekly_schedule ?? []).length === 7
      ? row.config!.weekly_schedule!
      : createDefaultWeeklySchedule();
    ws.forEach((d, i) => {
      d.cargaHoraria = computeCargaHoraria(d);
    });
    setForm({
      number: row.number ?? '',
      description: row.description ?? row.name ?? '',
      name: row.name ?? '',
      start_time: toTimeStr(row.start_time),
      break_start_time: row.break_start_time ?? '12:00',
      break_end_time: row.break_end_time ?? '13:00',
      end_time: toTimeStr(row.end_time),
      tolerance_minutes: row.tolerance_minutes ?? 15,
      shift_type: row.shift_type ?? 'fixed',
      intervalo_auto_minutos: row.break_minutes ?? row.break_duration ?? 60,
      weeklySchedule: ws,
      dsr: row.config?.dsr ?? { tipo: 'automatico' },
      extras: row.config?.extras ?? { acumular: 'independentes', controleHoras: 'diario', numeroFaixas: 3 },
      tipoMarcacao: row.config?.tipoMarcacao ?? { tipo: 'normal' },
    });
    setModalOpen(true);
  };

  const openDuplicate = (row: ShiftRow) => {
    setEditingId(null);
    const ws = (row.config?.weekly_schedule ?? []).length === 7 ? [...row.config!.weekly_schedule!] : createDefaultWeeklySchedule();
    setForm({
      number: '',
      description: `${row.description || row.name} (cópia)`,
      name: `${row.name} (cópia)`,
      start_time: toTimeStr(row.start_time),
      break_start_time: row.break_start_time ?? '12:00',
      break_end_time: row.break_end_time ?? '13:00',
      end_time: toTimeStr(row.end_time),
      tolerance_minutes: row.tolerance_minutes ?? 15,
      shift_type: row.shift_type ?? 'fixed',
      intervalo_auto_minutos: row.break_minutes ?? row.break_duration ?? 60,
      weeklySchedule: ws,
      dsr: row.config?.dsr ?? { tipo: 'automatico' },
      extras: row.config?.extras ?? { acumular: 'independentes', controleHoras: 'diario', numeroFaixas: 3 },
      tipoMarcacao: row.config?.tipoMarcacao ?? { tipo: 'normal' },
    });
    setModalOpen(true);
  };

  const updateDay = (dayIndex: number, upd: Partial<WeeklyScheduleDay>) => {
    setForm((f) => {
      const next = f.weeklySchedule.map((d) => (d.dayIndex === dayIndex ? { ...d, ...upd } : d));
      const day = next.find((d) => d.dayIndex === dayIndex);
      if (day && upd.dayType === undefined) day.cargaHoraria = computeCargaHoraria(day);
      return { ...f, weeklySchedule: next };
    });
  };

  const cycleDayType = (dayIndex: number): DayScheduleType => {
    const day = form.weeklySchedule.find((d) => d.dayIndex === dayIndex);
    if (!day) return 'normal';
    const next: Record<DayScheduleType, DayScheduleType> = { normal: 'extra', extra: 'folga', folga: 'normal' };
    const newType = next[day.dayType];
    updateDay(dayIndex, { dayType: newType });
    return newType;
  };

  const copyMondayToAll = () => {
    const monday = form.weeklySchedule.find((d) => d.dayIndex === 0);
    if (!monday) return;
    setForm((f) => ({
      ...f,
      weeklySchedule: f.weeklySchedule.map((d) => {
        const copy = { ...monday, dayIndex: d.dayIndex, dayType: d.dayType };
        copy.cargaHoraria = computeCargaHoraria(copy);
        return copy;
      }),
    }));
  };

  const handleSave = async () => {
    if (!isSupabaseConfigured) return;
    const nome = (form.description || form.name || '').trim() || (form.number ? `Horário ${form.number}` : 'Novo horário');
    if (!nome) {
      setMessage({ type: 'error', text: 'Informe a descrição (nome) do horário.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const first = form.weeklySchedule[0];
      const breakStart = first?.saida1 || form.break_start_time;
      const breakEnd = first?.entrada2 || form.break_end_time;
      const breakDurationMin = breakStart && breakEnd ? timeToMinutes(breakEnd) - timeToMinutes(breakStart) : form.intervalo_auto_minutos || 60;
      const payload: Record<string, any> = {
        name: nome,
        number: form.number.trim() || null,
        description: form.description.trim() || nome,
        start_time: first?.entrada1 || form.start_time,
        end_time: first?.saida2 || first?.saida1 || form.end_time,
        break_start_time: breakStart,
        break_end_time: breakEnd,
        break_duration: breakDurationMin,
        tolerance_minutes: first?.toleranciaFaltas ?? form.tolerance_minutes,
        shift_type: form.shift_type,
        break_minutes: form.intervalo_auto_minutos || breakDurationMin,
        config: {
          weekly_schedule: form.weeklySchedule.map((d) => ({ ...d, cargaHoraria: computeCargaHoraria(d) })),
          dsr: form.dsr,
          extras: form.extras,
          tipoMarcacao: form.tipoMarcacao,
        },
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

  const inputClass = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm`}>
          {message.text}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Cadastro de Horários" />
        <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
          <Plus className="w-5 h-5" /> Incluir horário
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
        {loadingData ? (
          <div className="p-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nº</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Entrada / Saída</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.number || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.description || row.name}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                    {toTimeStr(row.start_time)} – {toTimeStr(row.end_time)}
                    {row.break_start_time && row.break_end_time && ` (intervalo ${toTimeStr(row.break_start_time)}–${toTimeStr(row.break_end_time)})`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openDuplicate(row)} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg" title="Duplicar"><Copy className="w-4 h-4" /></button>
                    <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg" title="Editar"><Pencil className="w-4 h-4" /></button>
                    <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loadingData && rows.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum horário cadastrado. Clique em &quot;Incluir horário&quot; para começar.</p>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] overflow-y-auto flex items-start justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-6xl my-8 p-6 space-y-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Horário' : 'Incluir Horário'}</h3>

            {/* Incluir horário: Número, Descrição e Tipo de Jornada */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Número</label>
                <input type="text" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className={inputClass} placeholder="Número do horário" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} placeholder="Nome do horário" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de jornada</label>
                <select
                  value={form.shift_type}
                  onChange={(e) => setForm({ ...form, shift_type: e.target.value as ShiftRow['shift_type'] })}
                  className={inputClass}
                >
                  <option value="fixed">Fixa</option>
                  <option value="flexible">Flexível</option>
                  <option value="6x1">6x1</option>
                  <option value="5x2">5x2</option>
                  <option value="12x36">12x36</option>
                  <option value="24x72">24x72</option>
                  <option value="custom">Personalizada</option>
                </select>
              </div>
            </div>

            {/* Tolerância geral e intervalo automático */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tolerância geral (minutos)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.tolerance_minutes}
                  onChange={(e) => setForm({ ...form, tolerance_minutes: Number(e.target.value || 0) })}
                  className={inputClass}
                  placeholder="Ex: 10"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Usada para arredondar pequenos atrasos/adiantamentos na jornada (base legal/operacional).
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Intervalo automático (minutos)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.intervalo_auto_minutos}
                  onChange={(e) => setForm({ ...form, intervalo_auto_minutos: Number(e.target.value || 0) })}
                  className={inputClass}
                  placeholder="Ex: 60"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Tempo mínimo de intervalo a aplicar automaticamente quando não houver marcação de saída/retorno (Portaria 671).
                </p>
              </div>
            </div>

            {/* Tabela semanal */}
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Cada linha corresponde a um dia da semana. Clique no nome do dia para alternar: Normal → Extra → Folga.</p>
              <button type="button" onClick={copyMondayToAll} className="mb-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">Copiar de Segunda até Domingo</button>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800">
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300 text-left w-24">Dia</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Entrada1</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Saída1</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Entrada2</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Saída2</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Entrada3</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Saída3</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Tol. Extras</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Tol. Faltas</th>
                      <th className="px-2 py-2 font-bold text-slate-600 dark:text-slate-300">Carga horária</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.weeklySchedule.map((day) => (
                      <tr key={day.dayIndex} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => cycleDayType(day.dayIndex)}
                            className={`font-medium text-left w-full px-2 py-1 rounded ${day.dayType === 'folga' ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : day.dayType === 'extra' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200' : 'text-slate-800 dark:text-slate-200'}`}
                            title="Clique: Extra, dois cliques: Folga"
                          >
                            {DAY_LABELS[day.dayIndex]} {day.dayType !== 'normal' && `(${day.dayType === 'extra' ? 'Extra' : 'Folga'})`}
                          </button>
                        </td>
                        {day.dayType === 'normal' ? (
                          <>
                            <td className="px-2 py-1"><input type="time" value={day.entrada1} onChange={(e) => updateDay(day.dayIndex, { entrada1: e.target.value })} className={inputClass} /></td>
                            <td className="px-2 py-1"><input type="time" value={day.saida1} onChange={(e) => updateDay(day.dayIndex, { saida1: e.target.value })} className={inputClass} /></td>
                            <td className="px-2 py-1"><input type="time" value={day.entrada2} onChange={(e) => updateDay(day.dayIndex, { entrada2: e.target.value })} className={inputClass} /></td>
                            <td className="px-2 py-1"><input type="time" value={day.saida2} onChange={(e) => updateDay(day.dayIndex, { saida2: e.target.value })} className={inputClass} /></td>
                            <td className="px-2 py-1"><input type="time" value={day.entrada3} onChange={(e) => updateDay(day.dayIndex, { entrada3: e.target.value })} className={inputClass} /></td>
                            <td className="px-2 py-1"><input type="time" value={day.saida3} onChange={(e) => updateDay(day.dayIndex, { saida3: e.target.value })} className={inputClass} /></td>
                            <td className="px-2 py-1"><input type="number" min={0} value={day.toleranciaExtras} onChange={(e) => updateDay(day.dayIndex, { toleranciaExtras: Number(e.target.value) })} className={inputClass} title="Minutos de tolerância para hora extra" /></td>
                            <td className="px-2 py-1"><input type="number" min={0} value={day.toleranciaFaltas} onChange={(e) => updateDay(day.dayIndex, { toleranciaFaltas: Number(e.target.value) })} className={inputClass} title="Minutos de tolerância para falta" /></td>
                            <td className="px-2 py-1 tabular-nums text-slate-600 dark:text-slate-400">{computeCargaHoraria(day)}</td>
                          </>
                        ) : (
                          <>
                            <td colSpan={6} className="px-2 py-1 text-slate-500 dark:text-slate-400 italic">{day.dayType === 'extra' ? 'Extra' : 'Folga'}</td>
                            <td className="px-2 py-1"><input type="number" min={0} value={day.toleranciaExtras} onChange={(e) => updateDay(day.dayIndex, { toleranciaExtras: Number(e.target.value) })} className={inputClass} /></td>
                            <td className="px-2 py-1"><input type="number" min={0} value={day.toleranciaFaltas} onChange={(e) => updateDay(day.dayIndex, { toleranciaFaltas: Number(e.target.value) })} className={inputClass} /></td>
                            <td className="px-2 py-1 tabular-nums">00:00</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Menu Opções: Descanso, Extras, Tipo de marcação */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <button type="button" onClick={() => setOpcoesOpen((o) => ({ ...o, descanso: !o.descanso }))} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 text-left font-medium text-slate-800 dark:text-slate-200">
                Opções – Descanso (DSR)
                {opcoesOpen.descanso ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </button>
              {opcoesOpen.descanso && (
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de DSR</label>
                    <select value={form.dsr.tipo} onChange={(e) => setForm((f) => ({ ...f, dsr: { ...f.dsr, tipo: e.target.value as 'automatico' | 'variavel' } }))} className={inputClass}>
                      <option value="automatico">Automático</option>
                      <option value="variavel">Variável</option>
                    </select>
                  </div>
                  {form.dsr.tipo === 'automatico' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Limite de Horas faltas</label>
                        <input type="number" min={0} value={form.dsr.limiteHorasFaltas ?? ''} onChange={(e) => setForm((f) => ({ ...f, dsr: { ...f.dsr, limiteHorasFaltas: e.target.value ? Number(e.target.value) : undefined } }))} className={inputClass} placeholder="Horas" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor DSR (horas)</label>
                        <input type="text" value={form.dsr.valorDSRHoras ?? ''} onChange={(e) => setForm((f) => ({ ...f, dsr: { ...f.dsr, valorDSRHoras: e.target.value } }))} className={inputClass} placeholder="Ex: 08:00" />
                      </div>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={form.dsr.incluirHorasExtrasNoCalculo ?? false} onChange={(e) => setForm((f) => ({ ...f, dsr: { ...f.dsr, incluirHorasExtrasNoCalculo: e.target.checked } }))} />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Incluir Horas Extras no cálculo</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={form.dsr.descontarSemanaSeguinte ?? false} onChange={(e) => setForm((f) => ({ ...f, dsr: { ...f.dsr, descontarSemanaSeguinte: e.target.checked } }))} />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Descontar também da semana seguinte</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={form.dsr.incluirFeriados ?? false} onChange={(e) => setForm((f) => ({ ...f, dsr: { ...f.dsr, incluirFeriados: e.target.checked } }))} />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Incluir feriados</span>
                      </label>
                    </>
                  )}
                </div>
              )}

              <button type="button" onClick={() => setOpcoesOpen((o) => ({ ...o, extras: !o.extras }))} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 text-left font-medium text-slate-800 dark:text-slate-200 border-t border-slate-200 dark:border-slate-700">
                Opções – Extras
                {opcoesOpen.extras ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </button>
              {opcoesOpen.extras && (
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Acumular</label>
                    <select value={form.extras.acumular} onChange={(e) => setForm((f) => ({ ...f, extras: { ...f.extras, acumular: e.target.value as any } }))} className={inputClass}>
                      <option value="independentes">Independentes</option>
                      <option value="uteis_sabados">Úteis + Sábados</option>
                      <option value="uteis_sabados_domingos">Úteis + Sábados + Domingos</option>
                      <option value="uteis_sabados_domingos_feriados">Úteis + Sábados + Domingos + Feriados</option>
                      <option value="sabados_domingos">Sábados + Domingos</option>
                      <option value="sabados_domingos_feriados">Sábados + Domingos + Feriados</option>
                      <option value="domingos_feriados">Domingos + Feriados</option>
                      <option value="uteis_sabados_e_domingos_feriados">(Úteis + Sábados) e (Domingos + Feriados)</option>
                      <option value="uteis_domingos_e_sabados_feriados">(Úteis + Domingos) e (Sábados + Feriados)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Controle de Horas</label>
                    <select value={form.extras.controleHoras} onChange={(e) => setForm((f) => ({ ...f, extras: { ...f.extras, controleHoras: e.target.value as any } }))} className={inputClass}>
                      <option value="diario">Diário</option>
                      <option value="semanal">Semanal</option>
                      <option value="mensal">Mensal</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">N. de Faixas</label>
                    <input type="number" min={1} max={10} value={form.extras.numeroFaixas ?? 3} onChange={(e) => setForm((f) => ({ ...f, extras: { ...f.extras, numeroFaixas: Number(e.target.value) } }))} className={inputClass} />
                  </div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.extras.multiplicarExtrasPercentual ?? false} onChange={(e) => setForm((f) => ({ ...f, extras: { ...f.extras, multiplicarExtrasPercentual: e.target.checked } }))} />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Multiplicar Extras pelo percentual</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.extras.descontarFaltasDasExtras ?? false} onChange={(e) => setForm((f) => ({ ...f, extras: { ...f.extras, descontarFaltasDasExtras: e.target.checked } }))} />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Descontar faltas das extras</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.extras.bancoHorasHabilitado ?? false} onChange={(e) => setForm((f) => ({ ...f, extras: { ...f.extras, bancoHorasHabilitado: e.target.checked } }))} />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Habilitar Banco de Horas</span>
                  </label>
                </div>
              )}

              <button type="button" onClick={() => setOpcoesOpen((o) => ({ ...o, tipo: !o.tipo }))} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 text-left font-medium text-slate-800 dark:text-slate-200 border-t border-slate-200 dark:border-slate-700">
                Opções – Tipo de marcação
                {opcoesOpen.tipo ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </button>
              {opcoesOpen.tipo && (
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Configuração do tipo de marcação</label>
                    <select value={form.tipoMarcacao.tipo} onChange={(e) => setForm((f) => ({ ...f, tipoMarcacao: { ...f.tipoMarcacao, tipo: e.target.value as any } }))} className={inputClass}>
                      <option value="pre_assinalado">Pré-Assinalado</option>
                      <option value="normal">Normal</option>
                      <option value="tolerancia">Tolerância</option>
                      <option value="livre">Livre</option>
                      <option value="extra_anterior">Extra Anterior</option>
                      <option value="extra_posterior">Extra Posterior</option>
                      <option value="tolerancia_especifica">Tolerância Específica</option>
                    </select>
                  </div>
                  {form.tipoMarcacao.tipo === 'tolerancia_especifica' && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={form.tipoMarcacao.usarToleranciaEspecial ?? false} onChange={(e) => setForm((f) => ({ ...f, tipoMarcacao: { ...f.tipoMarcacao, usarToleranciaEspecial: e.target.checked } }))} />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Usar Tolerância especial</span>
                    </label>
                  )}
                </div>
              )}
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
