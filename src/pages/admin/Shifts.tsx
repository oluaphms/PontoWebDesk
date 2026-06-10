import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Copy } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured, type Filter } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import type {
  WeeklyScheduleDay,
  DayScheduleType,
  DSRConfig,
  ExtrasConfig,
  TipoMarcacaoConfig,
  OpcoesAvancadasHorario,
} from '../../../types';
import {
  createDefaultOpcoesAvancadas,
  mergeOpcoesAvancadas,
  createDefaultDSR,
  mergeDSR,
  createDefaultExtras,
  mergeExtras,
  createDefaultTipoMarcacao,
  mergeTipoMarcacao,
} from '../../../types';
import OpcoesAvancadasModal from './OpcoesAvancadasModal';
import ConfiguracaoDSRModal from './ConfiguracaoDSRModal';
import ConfiguracaoHorasExtrasModal from './ConfiguracaoHorasExtrasModal';
import TipoMarcacaoModal from './TipoMarcacaoModal';
import { SobreAvisoCadastroPanel } from '../../components/admin/SobreAvisoCadastroPanel';

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
  tolerancia_entrada: number;
  tolerancia_saida: number;
  /** Tipo de jornada (modelo de trabalho) */
  shift_type: 'fixed' | 'flexible' | '6x1' | '5x2' | '12x36' | '24x72' | 'custom';
  /** Intervalo mínimo/automático em minutos (Portaria 671) */
  break_minutes: number;
  /** Carga horária calculada em minutos */
  carga_horaria_minutos: number;
  /** Se é turno noturno */
  is_night_shift: boolean;
  /** Se o horário está ativo */
  ativo: boolean;
  config?: {
    weekly_schedule?: WeeklyScheduleDay[];
    dsr?: DSRConfig;
    extras?: ExtrasConfig;
    tipoMarcacao?: TipoMarcacaoConfig;
    opcoes_avancadas?: OpcoesAvancadasHorario;
  };
}

const AdminShifts: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [advancedModalOpen, setAdvancedModalOpen] = useState(false);
  const [extrasModalOpen, setExtrasModalOpen] = useState(false);
  const [tipoMarcacaoModalOpen, setTipoMarcacaoModalOpen] = useState(false);
  const [dsrModalOpen, setDsrModalOpen] = useState(false);
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
    tolerancia_entrada: 10,
    tolerancia_saida: 10,
    shift_type: 'fixed' as ShiftRow['shift_type'],
    intervalo_auto_minutos: 60,
    ativo: true,
    weeklySchedule: createDefaultWeeklySchedule(),
    dsr: createDefaultDSR(),
    extras: createDefaultExtras(),
    tipoMarcacao: createDefaultTipoMarcacao(),
    opcoesAvancadas: createDefaultOpcoesAvancadas(),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const toTimeStr = (v: string) => (v && v.length >= 5 ? v.slice(0, 5) : '—');

  const load = async () => {
    if (!isSupabaseConfigured()) return;
    setLoadingData(true);
    try {
      const filters: Filter[] | undefined = user?.companyId
        ? [{ column: 'company_id', operator: 'eq', value: user.companyId }]
        : undefined;
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
          tolerancia_entrada: r.tolerancia_entrada ?? r.tolerance_minutes ?? 10,
          tolerancia_saida: r.tolerancia_saida ?? r.tolerance_minutes ?? 10,
          shift_type: (r.shift_type as ShiftRow['shift_type']) || 'fixed',
          break_minutes: r.break_minutes ?? r.break_duration ?? 60,
          carga_horaria_minutos: r.carga_horaria_minutos ?? 0,
          is_night_shift: r.is_night_shift ?? r.night_shift ?? false,
          ativo: r.ativo ?? true,
          config: (r.config ?? {}) as ShiftRow['config'],
        }))
      );
    } catch (e) {
      observabilityConsole.error(e);
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
      tolerancia_entrada: 10,
      tolerancia_saida: 10,
      shift_type: 'fixed',
      intervalo_auto_minutos: 60,
      ativo: true,
      weeklySchedule: ws,
      dsr: createDefaultDSR(),
      extras: createDefaultExtras(),
      tipoMarcacao: createDefaultTipoMarcacao(),
      opcoesAvancadas: createDefaultOpcoesAvancadas(),
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
      tolerancia_entrada: row.tolerancia_entrada ?? 10,
      tolerancia_saida: row.tolerancia_saida ?? 10,
      shift_type: row.shift_type ?? 'fixed',
      intervalo_auto_minutos: row.break_minutes ?? row.break_duration ?? 60,
      ativo: row.ativo ?? true,
      weeklySchedule: ws,
      dsr: mergeDSR(createDefaultDSR(), row.config?.dsr),
      extras: mergeExtras(createDefaultExtras(), row.config?.extras),
      tipoMarcacao: mergeTipoMarcacao(createDefaultTipoMarcacao(), row.config?.tipoMarcacao),
      opcoesAvancadas: mergeOpcoesAvancadas(createDefaultOpcoesAvancadas(), row.config?.opcoes_avancadas),
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
      tolerancia_entrada: row.tolerancia_entrada ?? 10,
      tolerancia_saida: row.tolerancia_saida ?? 10,
      shift_type: row.shift_type ?? 'fixed',
      intervalo_auto_minutos: row.break_minutes ?? row.break_duration ?? 60,
      ativo: true,
      weeklySchedule: ws,
      dsr: mergeDSR(createDefaultDSR(), row.config?.dsr),
      extras: mergeExtras(createDefaultExtras(), row.config?.extras),
      tipoMarcacao: mergeTipoMarcacao(createDefaultTipoMarcacao(), row.config?.tipoMarcacao),
      opcoesAvancadas: mergeOpcoesAvancadas(createDefaultOpcoesAvancadas(), row.config?.opcoes_avancadas),
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
    if (!isSupabaseConfigured()) return;
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
        tolerancia_entrada: form.tolerancia_entrada,
        tolerancia_saida: form.tolerancia_saida,
        shift_type: form.shift_type,
        break_minutes: form.intervalo_auto_minutos || breakDurationMin,
        ativo: form.ativo,
        config: {
          weekly_schedule: form.weeklySchedule.map((d) => ({ ...d, cargaHoraria: computeCargaHoraria(d) })),
          dsr: form.dsr,
          extras: form.extras,
          tipoMarcacao: form.tipoMarcacao,
          opcoes_avancadas: form.opcoesAvancadas,
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
      setDsrModalOpen(false);
      setExtrasModalOpen(false);
      setTipoMarcacaoModalOpen(false);
      setAdvancedModalOpen(false);
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
        <PageHeader title="Cadastro de Horários" helpSlug="horarios" />
        <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
          <Plus className="w-5 h-5" /> Incluir horário
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
        {loadingData ? (
          <div className="p-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nº</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Entrada / Saída</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Carga</th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
                  <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const cargaHoras = row.carga_horaria_minutos ? `${String(Math.floor(row.carga_horaria_minutos / 60)).padStart(2, '0')}:${String(row.carga_horaria_minutos % 60).padStart(2, '0')}` : '—';
                  return (
                    <tr key={row.id} className={`border-b border-slate-100 dark:border-slate-800 ${!row.ativo ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.number || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <div className="flex items-center gap-2">
                          {row.description || row.name}
                          {row.is_night_shift && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded">Noturno</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                        <div className="space-y-0.5 whitespace-nowrap">
                          <div>{toTimeStr(row.start_time)} – {toTimeStr(row.end_time)}</div>
                          {row.break_start_time && row.break_end_time && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              intervalo {toTimeStr(row.break_start_time)}–{toTimeStr(row.break_end_time)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{cargaHoras}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${row.ativo ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                          {row.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => openDuplicate(row)} className="p-2 text-slate-500 hover:text-slate-700 rounded-lg" title="Duplicar"><Copy className="w-4 h-4" /></button>
                        <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg" title="Editar"><Pencil className="w-4 h-4" /></button>
                        <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loadingData && rows.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum horário cadastrado. Clique em &quot;Incluir horário&quot; para começar.</p>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto flex items-start justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!saving) {
              setDsrModalOpen(false);
              setExtrasModalOpen(false);
              setTipoMarcacaoModalOpen(false);
              setAdvancedModalOpen(false);
              setModalOpen(false);
            }
          }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-6xl my-8 p-6 space-y-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Horário' : 'Incluir Horário'}</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDsrModalOpen(true)}
                  className="text-sm font-medium px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Descanso
                </button>
                <button
                  type="button"
                  onClick={() => setExtrasModalOpen(true)}
                  className="text-sm font-medium px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Extra
                </button>
                <button
                  type="button"
                  onClick={() => setTipoMarcacaoModalOpen(true)}
                  className="text-sm font-medium px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Tipo
                </button>
                <button
                  type="button"
                  onClick={() => setAdvancedModalOpen(true)}
                  className="text-sm font-medium px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-indigo-700 dark:text-indigo-300 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Opções avançadas
                </button>
              </div>
            </div>

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

            {/* Tolerâncias e intervalo automático */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tolerância Entrada (min)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.tolerancia_entrada}
                  onChange={(e) => setForm({ ...form, tolerancia_entrada: Number(e.target.value || 0) })}
                  className={inputClass}
                  placeholder="Ex: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tolerância Saída (min)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.tolerancia_saida}
                  onChange={(e) => setForm({ ...form, tolerancia_saida: Number(e.target.value || 0) })}
                  className={inputClass}
                  placeholder="Ex: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Intervalo automático (min)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.intervalo_auto_minutos}
                  onChange={(e) => setForm({ ...form, intervalo_auto_minutos: Number(e.target.value || 0) })}
                  className={inputClass}
                  placeholder="Ex: 60"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.ativo}
                    onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                    className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Horário ativo</span>
                </label>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-2">
              Tolerâncias para arredondar pequenos atrasos/adiantamentos. Intervalo automático aplicado quando não houver marcação (Portaria 671).
            </p>

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

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDsrModalOpen(false);
                  setExtrasModalOpen(false);
                  setTipoMarcacaoModalOpen(false);
                  setAdvancedModalOpen(false);
                  setModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium"
              >
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}

      <TipoMarcacaoModal
        open={tipoMarcacaoModalOpen}
        onClose={() => setTipoMarcacaoModalOpen(false)}
        value={form.tipoMarcacao}
        onApply={(next) => setForm((f) => ({ ...f, tipoMarcacao: next }))}
      />

      <ConfiguracaoHorasExtrasModal
        open={extrasModalOpen}
        onClose={() => setExtrasModalOpen(false)}
        value={form.extras}
        onApply={(next) => setForm((f) => ({ ...f, extras: next }))}
        outrosHorarios={rows
          .filter((r) => (editingId ? r.id !== editingId : true))
          .map((r) => ({
            id: r.id,
            label: [r.number, r.description || r.name].filter(Boolean).join(' — ') || r.id,
          }))}
        getExtrasFromHorario={(id) => {
          if (!id) return undefined;
          const src = rows.find((r) => r.id === id);
          if (!src?.config?.extras) return undefined;
          return mergeExtras(createDefaultExtras(), src.config.extras);
        }}
      />

      <ConfiguracaoDSRModal
        open={dsrModalOpen}
        onClose={() => setDsrModalOpen(false)}
        value={form.dsr}
        onApply={(next) => setForm((f) => ({ ...f, dsr: next }))}
        outrosHorarios={rows
          .filter((r) => (editingId ? r.id !== editingId : true))
          .map((r) => ({
            id: r.id,
            label: [r.number, r.description || r.name].filter(Boolean).join(' — ') || r.id,
          }))}
        getDsrFromHorario={(id) => {
          if (!id) return undefined;
          const src = rows.find((r) => r.id === id);
          if (!src?.config?.dsr) return undefined;
          return mergeDSR(createDefaultDSR(), src.config.dsr);
        }}
      />

      <div className="mt-8">
        <SobreAvisoCadastroPanel />
      </div>

      <OpcoesAvancadasModal
        open={advancedModalOpen}
        onClose={() => setAdvancedModalOpen(false)}
        value={form.opcoesAvancadas}
        onChange={(next) => setForm((f) => ({ ...f, opcoesAvancadas: next }))}
        outrosHorarios={rows
          .filter((r) => (editingId ? r.id !== editingId : true))
          .map((r) => ({
            id: r.id,
            label: [r.number, r.description || r.name].filter(Boolean).join(' — ') || r.id,
          }))}
        onCopiarDeHorario={(id) => {
          if (!id) return;
          const src = rows.find((r) => r.id === id);
          if (!src) return;
          setForm((f) => ({
            ...f,
            opcoesAvancadas: mergeOpcoesAvancadas(createDefaultOpcoesAvancadas(), src.config?.opcoes_avancadas),
          }));
        }}
      />
    </div>
  );
};

export default AdminShifts;
