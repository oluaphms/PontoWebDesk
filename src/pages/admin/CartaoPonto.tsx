import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Save,
  User,
  AlertCircle,
  MoreVertical,
  FileText,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

type DayMeta = {
  comp: boolean;
  alm_livre: boolean;
  neutro: boolean;
  folga: boolean;
  n_banc: boolean;
  obs: string;
  ajuste: string;
  abono2: string;
  abono3: string;
  abono4: string;
  ref: string;
};

type DayData = {
  date: string;
  records: { id: string; type: string; created_at: string; is_manual?: boolean; manual_reason?: string }[];
  meta: DayMeta;
  metaId?: string;
};

const defaultDayMeta = (): DayMeta => ({
  comp: false,
  alm_livre: false,
  neutro: false,
  folga: false,
  n_banc: false,
  obs: '',
  ajuste: '',
  abono2: '',
  abono3: '',
  abono4: '',
  ref: '',
});

function timeStr(d: string): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.slice(11, 16) || '—';
  }
}

const AdminCartaoPonto: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const readOnly = location.pathname === '/admin/cartao-ponto-leitura';
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<{ id: string; nome: string; numero_folha?: string; department_id?: string }[]>([]);
  const [filterDept, setFilterDept] = useState<string>('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [records, setRecords] = useState<any[]>([]);
  const [diasMeta, setDiasMeta] = useState<Record<string, { id?: string; meta: DayMeta }>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [localMeta, setLocalMeta] = useState<Record<string, DayMeta>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [numeroFolhaInput, setNumeroFolhaInput] = useState('');

  const selectedEmployee = useMemo(() => {
    const filtered = filterDept
      ? employees.filter((e) => e.department_id === filterDept)
      : employees;
    const idx = Math.max(0, Math.min(selectedIndex, filtered.length - 1));
    return filtered[idx] ?? null;
  }, [employees, filterDept, selectedIndex]);

  const filteredEmployees = useMemo(() => {
    return filterDept ? employees.filter((e) => e.department_id === filterDept) : employees;
  }, [employees, filterDept]);

  const daysInPeriod = useMemo(() => {
    if (!periodStart || !periodEnd) return [];

    // Parse YYYY-MM-DD como data local (evita UTC)
    const parseLocalDate = (dateStr: string): Date => {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    };

    const start = parseLocalDate(periodStart);
    const end = parseLocalDate(periodEnd);
    const days: string[] = [];
    const d = new Date(start);
    while (d <= end) {
      // Formata como YYYY-MM-DD usando métodos locais
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      days.push(`${year}-${month}-${day}`);
      d.setDate(d.getDate() + 1);
    }
    return days;
  }, [periodStart, periodEnd]);

  const loadEmployees = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    try {
      const rows = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      setEmployees(
        (rows ?? []).map((u: any) => ({
          id: u.id,
          nome: u.nome || u.email || '',
          numero_folha: u.numero_folha,
          department_id: u.department_id,
        }))
      );
    } catch (e) {
      console.error(e);
    }
  }, [user?.companyId]);

  const loadRecordsAndDias = useCallback(async () => {
    if (!user?.companyId || !selectedEmployee || !isSupabaseConfigured || !periodStart || !periodEnd) {
      setRecords([]);
      setDiasMeta({});
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const [recs, dias] = await Promise.all([
        db.select('time_records', [
          { column: 'user_id', operator: 'eq', value: selectedEmployee.id },
        ]) as Promise<any[]>,
        db.select('cartao_ponto_dia', [
          { column: 'user_id', operator: 'eq', value: selectedEmployee.id },
        ]) as Promise<any[]>,
      ]);
      const byDate = new Map<string, any[]>();
      (recs ?? []).forEach((r: any) => {
        const d = (r.created_at || '').slice(0, 10);
        if (d >= periodStart && d <= periodEnd) {
          if (!byDate.has(d)) byDate.set(d, []);
          byDate.get(d)!.push(r);
        }
      });
      byDate.forEach((arr) => arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')));
      setRecords(recs ?? []);

      const metaMap: Record<string, { id?: string; meta: DayMeta }> = {};
      (dias ?? []).forEach((row: any) => {
        const d = row.data?.slice?.(0, 10) ?? row.data;
        if (d >= periodStart && d <= periodEnd) {
          metaMap[d] = {
            id: row.id,
            meta: {
              comp: !!row.comp,
              alm_livre: !!row.alm_livre,
              neutro: !!row.neutro,
              folga: !!row.folga,
              n_banc: !!row.n_banc,
              obs: row.obs ?? '',
              ajuste: row.ajuste != null ? String(row.ajuste) : '',
              abono2: row.abono2 != null ? String(row.abono2) : '',
              abono3: row.abono3 != null ? String(row.abono3) : '',
              abono4: row.abono4 != null ? String(row.abono4) : '',
              ref: row.ref ?? '',
            },
          };
        }
      });
      setDiasMeta(metaMap);
      setLocalMeta({});
      setDirty(new Set());
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar dados.' });
    } finally {
      setLoadingData(false);
    }
  }, [user?.companyId, selectedEmployee?.id, periodStart, periodEnd]);

  // Garante que o período esteja limpo na montagem (evita restauração de estado)
  useEffect(() => {
    setPeriodStart('');
    setPeriodEnd('');
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    loadRecordsAndDias();
  }, [loadRecordsAndDias]);

  const getPunchesForDay = (date: string) => {
    const dayRecs = records.filter((r) => (r.created_at || '').slice(0, 10) === date);
    const entradas = dayRecs.filter((r) => r.type === 'entrada').slice(0, 3);
    const saidas = dayRecs.filter((r) => r.type === 'saída').slice(0, 3);
    return {
      e1: entradas[0],
      e2: entradas[1],
      e3: entradas[2],
      s1: saidas[0],
      s2: saidas[1],
      s3: saidas[2],
    };
  };

  const getMetaForDay = (date: string): DayMeta => {
    if (localMeta[date]) return localMeta[date];
    const stored = diasMeta[date];
    if (stored) return stored.meta;
    return defaultDayMeta();
  };

  const setMetaForDay = (date: string, field: keyof DayMeta, value: boolean | string) => {
    const prev = getMetaForDay(date);
    const next = { ...prev, [field]: value };
    setLocalMeta((m) => ({ ...m, [date]: next }));
    setDirty((d) => new Set(d).add(date));
  };

  const handleSave = async () => {
    if (!selectedEmployee || !user?.companyId || !isSupabaseConfigured || dirty.size === 0) {
      if (dirty.size === 0) setMessage({ type: 'error', text: 'Nenhuma alteração para salvar.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      for (const date of dirty) {
        const meta = localMeta[date] ?? getMetaForDay(date);
        const existing = diasMeta[date];
        const payload = {
          comp: meta.comp,
          alm_livre: meta.alm_livre,
          neutro: meta.neutro,
          folga: meta.folga,
          n_banc: meta.n_banc,
          obs: meta.obs || null,
          ajuste: meta.ajuste ? parseFloat(meta.ajuste.replace(',', '.')) : null,
          abono2: meta.abono2 ? parseFloat(meta.abono2.replace(',', '.')) : null,
          abono3: meta.abono3 ? parseFloat(meta.abono3.replace(',', '.')) : null,
          abono4: meta.abono4 ? parseFloat(meta.abono4.replace(',', '.')) : null,
          ref: meta.ref || null,
        };
        if (existing?.id) {
          await db.update('cartao_ponto_dia', existing.id, payload);
        } else {
          await db.insert('cartao_ponto_dia', {
            id: crypto.randomUUID(),
            user_id: selectedEmployee.id,
            company_id: user.companyId,
            data: date,
            ...payload,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }
      setDirty(new Set());
      setMessage({ type: 'success', text: 'Alterações salvas.' });
      loadRecordsAndDias();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const goPrevEmployee = () => setSelectedIndex((i) => Math.max(0, i - 1));
  const goNextEmployee = () => setSelectedIndex((i) => Math.min(filteredEmployees.length - 1, i + 1));

  const selectByNumeroFolha = () => {
    const v = numeroFolhaInput.trim();
    if (!v) return;
    const idx = filteredEmployees.findIndex((e) => (e.numero_folha || '').toString() === v);
    if (idx >= 0) setSelectedIndex(idx);
    setNumeroFolhaInput('');
  };

  const formatDateBr = (d: string) => {
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-4">
        <PageHeader
          title={readOnly ? 'Cartão Ponto (Somente Leitura)' : 'Cartão Ponto'}
          subtitle={readOnly
            ? 'Visualize marcações e justificativas lançadas no período. Incluir, Alterar, Excluir e Salvar estão desativados.'
            : 'Acesso completo: visualize e mantenha registros de qualquer funcionário e mês. Campos alterados ficam em destaque até salvar.'}
          icon={<Calendar size={24} />}
        />

        {message && (
          <div
            className={`p-4 rounded-xl text-sm ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Departamento</label>
            <select
              value={filterDept}
              onChange={(e) => { setFilterDept(e.target.value); setSelectedIndex(0); }}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[160px]"
            >
              <option value="">Todos</option>
              {[...new Set(employees.map((e) => e.department_id).filter(Boolean))].map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (início)</label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              autoComplete="off"
              placeholder="dd/mm/aaaa"
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (fim)</label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              autoComplete="off"
              placeholder="dd/mm/aaaa"
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          {(periodStart || periodEnd) && (
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => { setPeriodStart(''); setPeriodEnd(''); }}
                className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                title="Limpar período"
              >
                Limpar
              </button>
            </div>
          )}
        </div>

        {/* Controles: Nº Folha, Nome, navegação, Atualizar, Opções */}
        <div className="flex flex-wrap gap-4 items-center p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Nº Folha</label>
            <input
              type="text"
              value={numeroFolhaInput}
              onChange={(e) => setNumeroFolhaInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectByNumeroFolha(); } }}
              placeholder="Digite e Enter/Tab"
              className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-slate-500" />
            <span className="font-medium text-slate-900 dark:text-white">
              {selectedEmployee ? selectedEmployee.nome : 'Selecione um funcionário'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goPrevEmployee}
              disabled={!selectedEmployee || selectedIndex <= 0}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              title="Funcionário anterior"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={goNextEmployee}
              disabled={!selectedEmployee || selectedIndex >= filteredEmployees.length - 1}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              title="Próximo funcionário"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => selectedEmployee && navigate(`/admin/employees?highlight=${selectedEmployee.id}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm"
            title="Abrir cadastro do funcionário"
          >
            <User className="w-4 h-4" /> Cadastro
          </button>
          <button type="button" onClick={loadRecordsAndDias} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm">
            Atualizar
          </button>
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setOptionsOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm"
            >
              <MoreVertical className="w-4 h-4" /> Opções
            </button>
            {optionsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOptionsOpen(false)} />
                <div className="absolute right-0 top-full mt-1 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-50 min-w-[200px]">
                  <button type="button" className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setOptionsOpen(false); /* TODO: Ajustes Parciais */ }}>
                    Ajustes Parciais
                  </button>
                  <button type="button" className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setOptionsOpen(false); /* TODO: Registro de Funções */ }}>
                    Registro de Funções
                  </button>
                  <button type="button" className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setOptionsOpen(false); /* TODO: Sobre Aviso */ }}>
                    Sobre Aviso
                  </button>
                  <button type="button" className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setOptionsOpen(false); /* TODO: Horas em Espera */ }}>
                    Horas em Espera
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Salvar (oculto em somente leitura) */}
        {!readOnly && dirty.size > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-800 dark:text-amber-200">
              Campos alterados (em vermelho) ainda não foram salvos.
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" /> Salvar
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto">
          {!periodStart || !periodEnd ? (
            <div className="p-12 text-center text-slate-500">
              <p className="mb-2">Selecione o período (início e fim) para visualizar os dados.</p>
              <p className="text-sm text-slate-400">Preencha as datas acima e os dados serão carregados automaticamente.</p>
            </div>
          ) : loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : !selectedEmployee ? (
            <div className="p-12 text-center text-slate-500">Selecione um funcionário (Nº Folha ou navegação).</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">Data</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Entrada 1</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Entrada 2</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Entrada 3</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Saída 1</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Saída 2</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Saída 3</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400" title="Compensado">Comp</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400" title="Almoço Livre">Alm Liv</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Neutro</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Folga</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400" title="Não calculado no banco de horas">N Banc</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">OBS</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Ajuste</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Abono2</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Abono3</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Abono4</th>
                  <th className="text-left px-2 py-2 font-bold text-slate-500 dark:text-slate-400">Ref</th>
                </tr>
              </thead>
              <tbody>
                {daysInPeriod.map((date) => {
                  const punches = getPunchesForDay(date);
                  const meta = getMetaForDay(date);
                  const isDirty = dirty.has(date);
                  return (
                    <tr key={date} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-2 py-1.5 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatDateBr(date)}</td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {punches.e1 && (
                          <span title={punches.e1.is_manual && punches.e1.manual_reason ? punches.e1.manual_reason : undefined} className={punches.e1.is_manual ? 'text-red-600 dark:text-red-400' : ''}>
                            {timeStr(punches.e1.created_at)}{punches.e1.is_manual ? ' ⚠' : ''}
                          </span>
                        )}
                        {!punches.e1 && '—'}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{punches.e2 ? timeStr(punches.e2.created_at) : '—'}</td>
                      <td className="px-2 py-1.5 tabular-nums">{punches.e3 ? timeStr(punches.e3.created_at) : '—'}</td>
                      <td className="px-2 py-1.5 tabular-nums">{punches.s1 ? timeStr(punches.s1.created_at) : '—'}</td>
                      <td className="px-2 py-1.5 tabular-nums">{punches.s2 ? timeStr(punches.s2.created_at) : '—'}</td>
                      <td className="px-2 py-1.5 tabular-nums">{punches.s3 ? timeStr(punches.s3.created_at) : '—'}</td>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={meta.comp}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'comp', e.target.checked)}
                          disabled={readOnly}
                          className="rounded border-slate-300"
                          title="Compensado"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={meta.alm_livre}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'alm_livre', e.target.checked)}
                          disabled={readOnly}
                          className="rounded border-slate-300"
                          title="Almoço Livre"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={meta.neutro}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'neutro', e.target.checked)}
                          disabled={readOnly}
                          className="rounded border-slate-300"
                          title="Neutro"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={meta.folga}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'folga', e.target.checked)}
                          disabled={readOnly}
                          className="rounded border-slate-300"
                          title="Folga"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={meta.n_banc}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'n_banc', e.target.checked)}
                          disabled={readOnly}
                          className="rounded border-slate-300"
                          title="Não calculado no banco de horas"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={meta.obs}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'obs', e.target.value)}
                          readOnly={readOnly}
                          className={`w-20 px-1.5 py-0.5 rounded border text-xs ${readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''} ${!readOnly && isDirty ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}
                          placeholder="OBS"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={meta.ajuste}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'ajuste', e.target.value)}
                          readOnly={readOnly}
                          className={`w-14 px-1.5 py-0.5 rounded border text-xs tabular-nums ${readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''} ${!readOnly && isDirty ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}
                          placeholder="+/-"
                          title="Ajuste (±)"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={meta.abono2}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'abono2', e.target.value)}
                          readOnly={readOnly}
                          className={`w-14 px-1.5 py-0.5 rounded border text-xs tabular-nums ${readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''} ${!readOnly && isDirty ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={meta.abono3}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'abono3', e.target.value)}
                          readOnly={readOnly}
                          className={`w-14 px-1.5 py-0.5 rounded border text-xs tabular-nums ${readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''} ${!readOnly && isDirty ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={meta.abono4}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'abono4', e.target.value)}
                          readOnly={readOnly}
                          className={`w-14 px-1.5 py-0.5 rounded border text-xs tabular-nums ${readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''} ${!readOnly && isDirty ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={meta.ref}
                          onChange={(e) => !readOnly && setMetaForDay(date, 'ref', e.target.value)}
                          readOnly={readOnly}
                          className={`w-16 px-1.5 py-0.5 rounded border text-xs ${readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''} ${!readOnly && isDirty ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700'} bg-white dark:bg-slate-800`}
                          placeholder="Ref"
                          title="Reserva de refeição"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminCartaoPonto;
