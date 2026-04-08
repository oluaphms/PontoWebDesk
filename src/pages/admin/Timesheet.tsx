import React, { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import { FileDown, FileSpreadsheet, Pencil, Trash2, Lock } from 'lucide-react';
import { closeTimesheet } from '../../services/timeProcessingService';
import { buildDayMirrorSummary } from '../../utils/timesheetMirror';
import { extractLatLng, reverseGeocode } from '../../utils/reverseGeocode';
import { StreetAddress } from '../../components/StreetAddress';

type DaySummary = {
  date: string;
  entradaInicio: string;
  saidaIntervalo: string;
  voltaIntervalo: string;
  saidaFinal: string;
  workedHours: string;
  status: string;
  locationCoords?: { lat: number; lng: number };
};

type TimesheetRow = {
  userId: string;
  userName: string;
  departmentName?: string;
  byDate: Map<string, DaySummary>;
  dates: string[];
};

type EditingRecord = { id: string; type: string; created_at: string };

const AdminTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<{ id: string; nome: string; department_id?: string }[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [filterDept, setFilterDept] = useState<string>('');
  const [periodStart, setPeriodStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [loadingData, setLoadingData] = useState(true);
  const [editingRecord, setEditingRecord] = useState<EditingRecord | null>(null);
  const [editForm, setEditForm] = useState({ type: 'entrada', created_at: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [closeMonth, setCloseMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [closing, setClosing] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleExpandedRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const load = async () => {
      setLoadingData(true);
      try {
        const [usersRows, recordsRows] = await Promise.all([
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('time_records', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'created_at', ascending: false }, 2000) as Promise<any[]>,
        ]);
        setEmployees((usersRows ?? []).map((u: any) => ({ id: u.id, nome: u.nome || u.email, department_id: u.department_id })));
        setRecords(recordsRows ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user?.companyId]);

  const filteredRecords = useMemo(() => {
    let list = records;
    if (filterUserId) list = list.filter((r: any) => r.user_id === filterUserId);
    if (filterDept) list = list.filter((r: any) => {
      const emp = employees.find((e) => e.id === r.user_id);
      return emp?.department_id === filterDept;
    });
    if (periodStart) list = list.filter((r: any) => (r.created_at || '').slice(0, 10) >= periodStart);
    if (periodEnd) list = list.filter((r: any) => (r.created_at || '').slice(0, 10) <= periodEnd);
    return list;
  }, [records, filterUserId, filterDept, periodStart, periodEnd, employees]);

  const buildRows = useMemo((): TimesheetRow[] => {
    const byUser = new Map<string, { userName: string; departmentId?: string; recs: any[] }>();
    const userNames = new Map<string, string>(employees.map((e) => [e.id, e.nome]));
    filteredRecords.forEach((r: any) => {
      const uid = r.user_id;
      if (!byUser.has(uid)) byUser.set(uid, { userName: userNames.get(uid) || uid.slice(0, 8), departmentId: undefined, recs: [] });
      byUser.get(uid)!.recs.push(r);
    });
    const rows: TimesheetRow[] = [];
    byUser.forEach((data, userId) => {
      const byDate = new Map<string, DaySummary>();
      const datesSet = new Set<string>();
      data.recs.sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''));
      data.recs.forEach((r: any) => {
        datesSet.add((r.created_at || '').slice(0, 10));
      });
      datesSet.forEach((d) => {
        const dayRecs = data.recs.filter((r: any) => (r.created_at || '').slice(0, 10) === d);
        const mirror = buildDayMirrorSummary(dayRecs);
        const locRow = dayRecs.find((r: any) => extractLatLng(r));
        const locationCoords = locRow ? extractLatLng(locRow) ?? undefined : undefined;
        byDate.set(d, {
          date: d,
          entradaInicio: mirror.entradaInicio,
          saidaIntervalo: mirror.saidaIntervalo,
          voltaIntervalo: mirror.voltaIntervalo,
          saidaFinal: mirror.saidaFinal,
          workedHours: mirror.workedHours,
          status: mirror.status,
          locationCoords,
        });
      });
      rows.push({
        userId,
        userName: data.userName,
        departmentName: data.departmentId,
        byDate: byDate,
        dates: [...datesSet].sort(),
      });
    });
    return rows.sort((a, b) => a.userName.localeCompare(b.userName));
  }, [filteredRecords, employees]);

  const handleExportPDF = () => {
    window.print();
  };

  const handleExportExcel = async () => {
    const headers = [
      'Funcionário',
      'Data',
      'Entrada (início)',
      'Intervalo (pausa)',
      'Retorno',
      'Saída (final)',
      'Horas trabalhadas',
      'Localização',
      'Métodos (batidas do dia)',
      'Status',
    ];
    const lines = [headers.join('\t')];
    for (const row of buildRows) {
      for (const d of row.dates) {
        const sum = row.byDate.get(d);
        const dayRecs = filteredRecords.filter(
          (r: any) => r.user_id === row.userId && (r.created_at || '').slice(0, 10) === d,
        );
        const methods = [...new Set(dayRecs.map((r: any) => (r.method || '—').toString()).filter(Boolean))].join(', ');
        let locText = '—';
        if (sum?.locationCoords) {
          locText = await reverseGeocode(sum.locationCoords.lat, sum.locationCoords.lng);
        }
        lines.push(
          [
            row.userName,
            d,
            sum?.entradaInicio ?? '',
            sum?.saidaIntervalo ?? '',
            sum?.voltaIntervalo ?? '',
            sum?.saidaFinal ?? '',
            sum?.workedHours ?? '',
            locText,
            methods || '—',
            sum?.status ?? '',
          ].join('\t'),
        );
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `espelho-ponto-${periodStart}-${periodEnd}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleEditRecord = (rec: any) => {
    if (!rec?.id) return;
    setEditingRecord({ id: rec.id, type: rec.type || 'entrada', created_at: rec.created_at || '' });
    setEditForm({
      type: rec.type || 'entrada',
      created_at: rec.created_at ? rec.created_at.slice(0, 16) : new Date().toISOString().slice(0, 16),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingRecord || !isSupabaseConfigured) return;
    setSavingEdit(true);
    setMessage(null);
    try {
      await db.update('time_records', editingRecord.id, {
        type: editForm.type,
        created_at: new Date(editForm.created_at).toISOString(),
      });
      setRecords((prev) =>
        prev.map((r: any) =>
          r.id === editingRecord.id
            ? { ...r, type: editForm.type, created_at: new Date(editForm.created_at).toISOString() }
            : r
        )
      );
      setEditingRecord(null);
      setMessage({ type: 'success', text: 'Registro atualizado.' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao atualizar.' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!confirm('Excluir este registro?')) return;
    setMessage(null);
    try {
      await db.delete('time_records', recordId);
      setRecords((prev) => prev.filter((r: any) => r.id !== recordId));
      setMessage({ type: 'success', text: 'Registro excluído.' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  const handleCloseTimesheet = async () => {
    if (!user?.companyId || !confirm(`Fechar folha de ponto do mês ${closeMonth}? Isso calculará totais e marcará a folha como fechada.`)) return;
    setMessage(null);
    setClosing(true);
    try {
      const [year, month] = closeMonth.split('-').map(Number);
      const { closed, errors } = await closeTimesheet(user.companyId, month, year);
      if (errors.length > 0) {
        setMessage({ type: 'error', text: `Fechado: ${closed}. Erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '...' : ''}` });
      } else {
        setMessage({ type: 'success', text: `Folha de ${closeMonth} fechada. ${closed} funcionário(s) processado(s).` });
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao fechar folha.' });
    } finally {
      setClosing(false);
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader title="Espelho de Ponto" />
      {message && (
        <div className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm`}>
          {message.text}
        </div>
      )}
      <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 print:hidden">
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Funcionário</label>
          <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]">
            <option value="">Todos</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Departamento</label>
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]">
            <option value="">Todos</option>
            {[...new Set(employees.map((e) => e.department_id).filter(Boolean))].map((deptId) => (
              <option key={deptId} value={deptId}>{deptId}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (início)</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (fim)</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleExportPDF} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <FileDown className="w-4 h-4" /> Exportar PDF
          </button>
          <button type="button" onClick={handleExportExcel} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
          </button>
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-200 dark:border-slate-700">
            <input type="month" value={closeMonth} onChange={(e) => setCloseMonth(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm" />
            <button type="button" onClick={handleCloseTimesheet} disabled={closing} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50" title="Fechar folha do mês (calcula totais e marca como fechada)">
              <Lock className="w-4 h-4" /> Fechar folha
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 print:border-0 print:shadow-none print:bg-transparent print:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0">
        {loadingData ? (
          <div className="p-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain touch-pan-x rounded-xl border border-slate-100 dark:border-slate-800 md:border-0">
          <table className="w-full text-xs sm:text-sm min-w-[1020px] md:min-w-0">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Entrada (início)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Intervalo (pausa)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Retorno</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Saída (final)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horas trabalhadas</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Localização</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Método</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400 print:hidden">Ações</th>
              </tr>
            </thead>
            <tbody>
              {buildRows.flatMap((row) =>
                row.dates.map((d) => {
                  const sum = row.byDate.get(d);
                  const dayRecs = filteredRecords.filter(
                    (r: any) => r.user_id === row.userId && (r.created_at || '').slice(0, 10) === d,
                  );
                  const rec = dayRecs[0];
                  const methodSummary = [...new Set(dayRecs.map((r: any) => (r.method || '—').toString()).filter(Boolean))].join(', ') || '—';
                  const rowKey = `${row.userId}-${d}`;
                  const isExpanded = expandedRows[rowKey] === true;
                  return (
                    <React.Fragment key={rowKey}>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td
                        className="px-4 py-3 text-slate-900 dark:text-white cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-300"
                        title={isExpanded ? 'Ocultar endereços das batidas' : 'Mostrar endereços das batidas'}
                        onClick={() => toggleExpandedRow(rowKey)}
                      >
                        {row.userName}
                      </td>
                      <td className="px-4 py-3">{d}</td>
                      <td className="px-4 py-3 tabular-nums">{sum?.entradaInicio || '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{sum?.saidaIntervalo || '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{sum?.voltaIntervalo || '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{sum?.saidaFinal || '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{sum?.workedHours || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs max-w-[220px]">
                        {sum?.locationCoords ? (
                          <StreetAddress lat={sum.locationCoords.lat} lng={sum.locationCoords.lng} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 max-w-[120px] truncate" title={methodSummary}>{methodSummary}</td>
                      <td className="px-4 py-3">{sum?.status || 'OK'}</td>
                      <td className="px-4 py-3 text-right print:hidden">
                        {rec && (
                          rec.nsr != null ? (
                            <span className="text-xs text-slate-400 dark:text-slate-500" title="Registro REP-P (Portaria 671) - correções via Ajustes de Ponto">REP-P</span>
                          ) : (
                            <>
                              <button type="button" onClick={() => handleEditRecord(rec)} className="p-1.5 text-slate-500 hover:text-indigo-600 rounded" title="Editar registro"><Pencil className="w-4 h-4 inline" /></button>
                              <button type="button" onClick={() => handleDeleteRecord(rec.id)} className="p-1.5 text-slate-500 hover:text-red-600 rounded" title="Excluir registro"><Trash2 className="w-4 h-4 inline" /></button>
                            </>
                          )
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800">
                        <td colSpan={11} className="px-4 py-3">
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            <p className="font-medium mb-2">Enderecos por batida do dia {d}:</p>
                            <div className="space-y-1">
                              {dayRecs
                                .slice()
                                .sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''))
                                .map((r: any) => {
                                  const ll = extractLatLng(r);
                                  const when = r.created_at
                                    ? new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                                    : '--:--';
                                  return (
                                    <div key={r.id || `${rowKey}-${when}`} className="flex flex-wrap gap-2">
                                      <span className="font-mono text-slate-500">{when}</span>
                                      <span className="uppercase text-[11px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                                        {(r.type || '—').toString()}
                                      </span>
                                      <span className="text-slate-500">-</span>
                                      {ll ? (
                                        <StreetAddress lat={ll.lat} lng={ll.lng} />
                                      ) : (
                                        <span className="text-slate-500">Batida sem GPS</span>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        )}
        {!loadingData && buildRows.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum registro no período.</p>
        )}
      </div>

      {editingRecord && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !savingEdit && setEditingRecord(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Editar Registro</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
              <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                <option value="entrada">Entrada</option>
                <option value="saída">Saída</option>
                <option value="pausa">Pausa</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data e hora</label>
              <input type="datetime-local" value={editForm.created_at} onChange={(e) => setEditForm({ ...editForm, created_at: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditingRecord(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
              <button type="button" onClick={handleSaveEdit} disabled={savingEdit} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTimesheet;
