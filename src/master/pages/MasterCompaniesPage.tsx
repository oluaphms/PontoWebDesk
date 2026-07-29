import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  Search,
  Filter,
  RefreshCw,
  Plus,
  Pencil,
  Ban,
  Unlock,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { MasterTenantsService } from '../services/masterTenantsService';
import type { MasterCompanyAction } from '../api/companiesApi';
import {
  fetchOperationalCompaniesDirectory,
  initializeOperationalCommercial,
  mapOperationalDirectoryRow,
  prepareCommercialFirstAccessPassword,
  resendCommercialFirstAccess,
} from '../api/companiesApi';
import type { MasterCompanyRow } from '../types/company';
import { COMPANY_TENANT_STATUSES, toCompanyStatusPt } from '../types/company';
import {
  CRM_SITUATIONS,
  fetchCrmDirectory,
  formatCrmDate,
  type CrmListRow,
} from '../api/crmApi';

import { MasterStatusBadge } from '../components/MasterStatusBadge';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';
import { MasterLicenseManagerService } from '../services/masterLicenseManagerService';
import type { CommercialLicenseViewState } from '../utils/licenseValidity';

const ALL = '';
const PLAN_OPTIONS = [
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'ANNUAL', label: 'Anual' },
];
const MODE_OPTIONS = ['SAAS', 'LOCAL', 'HYBRID'];
const STATUS_OPTIONS = COMPANY_TENANT_STATUSES.map((s) => ({
  value: s.toLowerCase(),
  label: s,
}));

type EnrichedRow = MasterCompanyRow & {
  crm?: CrmListRow | null;
  validityStatus?: CommercialLicenseViewState['displayStatus'];
  validityLabel?: string;
  licenseStartsAt?: string | null;
  licenseExpiresAt?: string | null;
};

/**
 * Empresas — descoberta automática do operacional + domínio comercial Master.
 * Não cria segunda company; inicializa apenas registros comerciais.
 */
export function MasterCompaniesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [orphansCount, setOrphansCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [temporaryPasswordByTenantId, setTemporaryPasswordByTenantId] = useState<Record<string, { value: string; expiresAt: string | null }>>({});
  const [query, setQuery] = useState('');
  const [filterPlan, setFilterPlan] = useState(ALL);
  const [filterMode, setFilterMode] = useState(ALL);
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [filterCity, setFilterCity] = useState(ALL);
  const [filterSituation, setFilterSituation] = useState(ALL);
  const [filterDueBefore, setFilterDueBefore] = useState('');
  const [filterLastAccessAfter, setFilterLastAccessAfter] = useState('');
  const [filterLastUpdateAfter, setFilterLastUpdateAfter] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const discovery = await fetchOperationalCompaniesDirectory({
        q: query.trim() || undefined,
      }).catch(() => null);

      let baseRows: MasterCompanyRow[] = [];
      if (discovery?.ok) {
        baseRows = discovery.companies.map(mapOperationalDirectoryRow);
        setOrphansCount(discovery.orphans?.length ?? 0);
      } else {
        baseRows = await MasterTenantsService.list({
          q: query.trim() || undefined,
          plan: filterPlan || undefined,
          mode: filterMode || undefined,
          status: filterStatus || undefined,
        });
        setOrphansCount(0);
      }

      const crmRows = await fetchCrmDirectory({
        q: query.trim() || undefined,
        city: filterCity || undefined,
        plan: filterPlan || undefined,
        situation: filterSituation || undefined,
        dueBefore: filterDueBefore || undefined,
        lastAccessAfter: filterLastAccessAfter
          ? new Date(filterLastAccessAfter).toISOString()
          : undefined,
        lastUpdateAfter: filterLastUpdateAfter
          ? new Date(filterLastUpdateAfter).toISOString()
          : undefined,
      }).catch(() => [] as CrmListRow[]);

      const licenses = await MasterLicenseManagerService.list().catch(() => []);
      const licenseByTenant = new Map(licenses.map((l) => [l.tenantId, l]));

      const crmByTenant = new Map(crmRows.map((c) => [c.masterTenantId, c]));
      const enriched: EnrichedRow[] = baseRows.map((t) => {
        const lic = t.id ? licenseByTenant.get(t.id) : undefined;
        // Fonte única: validity calculada no backend (directory e/ou license API).
        const validity =
          t.licenseValidity ??
          lic?.validity ??
          null;
        return {
          ...t,
          crm: (t.id && crmByTenant.get(t.id)) || null,
          validityStatus: validity?.displayStatus,
          validityLabel: validity?.remainingLabel,
          licenseStartsAt: validity?.startsAtEffective ?? null,
          licenseExpiresAt: validity?.expiresAt ?? null,
        };
      });

      const crmFilterActive = Boolean(
        filterCity ||
          filterSituation ||
          filterDueBefore ||
          filterLastAccessAfter ||
          filterLastUpdateAfter,
      );
      if (crmFilterActive) {
        const allowed = new Set(crmRows.map((c) => c.masterTenantId));
        setRows(
          enriched.filter(
            (r) => r.initStatus === 'not_initialized' || allowed.has(r.id),
          ),
        );
      } else {
        setRows(enriched);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar empresas');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.crm?.city) set.add(r.crm.city);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterPlan && r.plano !== filterPlan && r.crm?.contractedPlan !== filterPlan) return false;
      if (filterMode && r.modo !== filterMode) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterCity && (r.crm?.city || '').toLowerCase() !== filterCity.toLowerCase()) return false;
      if (filterSituation && r.crm?.situation !== filterSituation) return false;
      if (!q) return true;
      const hay = [
        r.empresa,
        r.document || '',
        r.plano,
        r.modo,
        r.status,
        r.dominio,
        r.operationalCompanyId || '',
        r.originLabel || '',
        r.crm?.contactName || '',
        r.crm?.city || '',
        r.crm?.email || '',
        r.crm?.situation || '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, filterPlan, filterMode, filterStatus, filterCity, filterSituation]);

  const hasActiveFilters = Boolean(
    filterPlan ||
      filterMode ||
      filterStatus ||
      filterCity ||
      filterSituation ||
      filterDueBefore ||
      filterLastAccessAfter ||
      filterLastUpdateAfter ||
      query,
  );

  async function runAction(id: string, action: MasterCompanyAction, e: React.MouseEvent) {
    e.stopPropagation();
    const labels: Record<MasterCompanyAction, string> = {
      block: 'bloquear',
      unblock: 'desbloquear',
      suspend: 'suspender',
      cancel: 'cancelar',
      activate: 'ativar',
      start_trial: 'iniciar período de teste',
    };
    if (!window.confirm(`Confirma ${labels[action]} esta empresa?`)) return;
    let reason: string | undefined;
    if (action === 'block') {
      const typed = window.prompt('Motivo do bloqueio administrativo (obrigatório):', '');
      reason = String(typed || '').trim();
      if (!reason) {
        setError('Informe o motivo do bloqueio para registrar na auditoria.');
        return;
      }
    }
    setBusyId(id);
    setError(null);
    try {
      await MasterTenantsService.action(id, action, reason);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao ${labels[action]}`);
    } finally {
      setBusyId(null);
    }
  }

  async function initializeCommercial(row: EnrichedRow, e: React.MouseEvent) {
    e.stopPropagation();
    const companyId = row.operationalCompanyId;
    if (!companyId) {
      setError('Empresa operacional sem ID — não é possível inicializar.');
      return;
    }
    if (
      !window.confirm(
        `Inicializar domínio comercial de "${row.empresa}"?\n\nSerão criados apenas: assinatura, plano, financeiro, notificações, CRM e licenciamento.\nNenhuma nova empresa operacional será criada.`,
      )
    ) {
      return;
    }
    setBusyId(companyId);
    setError(null);
    setNotice(null);
    try {
      const result = await initializeOperationalCommercial(companyId);
      setNotice(result.message);
      await load();
      if (result.masterTenantId) {
        navigate(`/master/tenants/${result.masterTenantId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao inicializar domínio comercial.');
    } finally {
      setBusyId(null);
    }
  }

  async function resendFirstAccess(row: EnrichedRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (!row.id?.startsWith('tn_')) return;
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const journey = await resendCommercialFirstAccess(row.id);
      setNotice(
        journey.firstAccessStatus === 'sent'
          ? 'Convite reenviado com sucesso.'
          : 'Convite processado.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reenviar convite inicial.');
    } finally {
      setBusyId(null);
    }
  }

  async function generateTemporaryPassword(row: EnrichedRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (!row.id?.startsWith('tn_')) return;
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const prepared = await prepareCommercialFirstAccessPassword(row.id);
      setTemporaryPasswordByTenantId((prev) => ({
        ...prev,
        [row.id]: { value: prepared.temporaryPassword, expiresAt: prepared.expiresAt },
      }));
      setNotice('Senha provisória gerada. Copie e envie ao administrador.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar senha provisória.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteCompany(row: EnrichedRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (!row.id?.startsWith('tn_')) {
      setError('Só é possível excluir empresas com domínio comercial Master (cadastro).');
      return;
    }
    if (
      !window.confirm(
        `Excluir permanentemente "${row.empresa}"?\n\nRemove tenant Master, domínio comercial e a empresa operacional vinculada.\nEsta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      await MasterTenantsService.delete(row.id);
      setNotice(`Empresa "${row.empresa}" excluída.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir empresa.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-7xl space-y-6">
      <MasterBackToDashboard />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
            CRM Comercial
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Empresas
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Descoberta automática do Sistema Operacional — domínio comercial Master sem duplicar
            empresa.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <Link
            to="/master/tenants/new"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-500/90 px-3 py-2 text-xs font-medium text-slate-950 hover:bg-indigo-400"
          >
            <Plus className="h-3.5 w-3.5" />
            Cadastrar
          </Link>
        </div>
      </header>

      {orphansCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {orphansCount} registro(s) comercial(is) órfão(s): empresa operacional ausente. Não
          removidos automaticamente — tratamento administrativo necessário.
        </div>
      )}

      {(error || notice) && (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            error
              ? 'border-rose-500/20 bg-rose-500/10 text-rose-600'
              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {error || notice}
        </p>
      )}

      <div className="space-y-3 rounded-2xl border border-border bg-surface shadow-card p-3 ">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load();
              }}
              placeholder="Buscar razão social, CNPJ, e-mail…"
              className="w-full rounded-xl border border-border-strong bg-surface py-2.5 pl-10 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs dark:border-slate-700"
          >
            <Filter className="h-3.5 w-3.5" />
            Filtrar
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="rounded-xl border border-border-strong bg-surface px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value={ALL}>Plano (todos)</option>
            {PLAN_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="rounded-xl border border-border-strong bg-surface px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value={ALL}>Modo (todos)</option>
            {MODE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-border-strong bg-surface px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value={ALL}>Status (todos)</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={filterCity}
            onChange={(e) => setFilterCity(e.target.value)}
            className="rounded-xl border border-border-strong bg-surface px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value={ALL}>Cidade (todas)</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filterSituation}
            onChange={(e) => setFilterSituation(e.target.value)}
            className="rounded-xl border border-border-strong bg-surface px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value={ALL}>Situação CRM (todas)</option>
            {CRM_SITUATIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setFilterPlan(ALL);
                setFilterMode(ALL);
                setFilterStatus(ALL);
                setFilterCity(ALL);
                setFilterSituation(ALL);
                setFilterDueBefore('');
                setFilterLastAccessAfter('');
                setFilterLastUpdateAfter('');
              }}
              className="text-xs text-indigo-400 hover:text-indigo-700"
            >
              Limpar pesquisa e filtros
            </button>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Carregando empresas…</p>}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900/30">
          <Building2 className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-600">Nenhuma empresa encontrada</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead className="border-b border-border bg-\[var\(--ds-table-head\)\] text-\[11px\] uppercase tracking-wide text-foreground-secondary">
                <tr>
                  <th className="px-3 py-3 font-medium">Razão social</th>
                  <th className="px-3 py-3 font-medium">CNPJ</th>
                  <th className="px-3 py-3 font-medium">Plano</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Vigência</th>
                  <th className="px-3 py-3 font-medium">Vencimento</th>
                  <th className="px-3 py-3 font-medium">Situação comercial</th>
                  <th className="px-3 py-3 font-medium">Primeiro acesso</th>
                  <th className="px-3 py-3 font-medium">Origem</th>
                  <th className="px-3 py-3 font-medium w-52">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {filtered.map((row) => {
                  const rowKey = `${row.operationalCompanyId || row.id}`;
                  const busy = busyId === row.id || busyId === row.operationalCompanyId;
                  const canBlock =
                    row.commercialInitialized &&
                    row.status !== 'blocked' &&
                    row.status !== 'cancelled';
                  const canUnblock =
                    row.commercialInitialized &&
                    (row.status === 'blocked' || row.status === 'suspended');
                  const notInitialized = row.initStatus === 'not_initialized';
                  return (
                    <tr
                      key={rowKey}
                      className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/60 ${
                        row.commercialInitialized ? 'cursor-pointer' : ''
                      }`}
                      onClick={() => {
                        if (row.commercialInitialized && row.id.startsWith('tn_')) {
                          navigate(`/master/tenants/${row.id}`);
                        }
                      }}
                    >
                      <td className="max-w-[220px] px-3 py-3">
                        <p className="truncate font-medium text-slate-900 dark:text-white">
                          {row.crm?.companyName || row.empresa}
                        </p>
                        {row.tradeName && (
                          <p className="truncate text-xs text-slate-500">{row.tradeName}</p>
                        )}
                        {notInitialized && (
                          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                            Empresa ainda não inicializada comercialmente
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">
                        {row.document || '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {row.crm?.contractedPlan || row.plano}
                      </td>
                      <td className="px-3 py-3">
                        <MasterStatusBadge status={row.status} />
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {toCompanyStatusPt(row.status)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                          {row.validityStatus || '—'}
                        </span>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {row.validityLabel || '—'}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-400">
                        {formatCrmDate(row.licenseExpiresAt || row.expiresAt || row.crm?.dueDate)}
                      </td>
                      <td className="px-3 py-3">
                        {notInitialized ? (
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            Pendente
                          </span>
                        ) : (
                          <MasterStatusBadge
                            status={row.crm?.situation || row.commercialSituation || '—'}
                          />
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {!row.commercialInitialized ? (
                          <span className="text-amber-700 dark:text-amber-300">⏳ Pendente</span>
                        ) : row.firstAccessStatus === 'accepted' ? (
                          <span className="text-emerald-700 dark:text-emerald-300">✅ Usuário ativo</span>
                        ) : row.firstAccessStatus === 'sent' ? (
                          <span className="text-emerald-700 dark:text-emerald-300">✅ Enviado</span>
                        ) : row.firstAccessStatus === 'failed' ? (
                          <span className="text-rose-700 dark:text-rose-300">
                            ❌ Falhou
                            {row.firstAccessLastError ? ` · ${row.firstAccessLastError}` : ''}
                          </span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-300">⏳ Pendente</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {row.originLabel || 'Operacional'}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center gap-1">
                          {notInitialized ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={(e) => void initializeCommercial(row, e)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 disabled:opacity-40 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                              title="Criar somente domínio comercial"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Inicializar Empresa
                            </button>
                          ) : (
                            <>
                              <Link
                                to={`/master/tenants/${row.id}`}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
                                title="Abrir Empresa"
                              >
                                Abrir
                              </Link>
                              <Link
                                to={`/master/tenants/${row.id}/edit`}
                                className="rounded-lg border border-slate-300 p-1.5 text-slate-600 dark:border-slate-700"
                                title="Editar"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                              {canBlock && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={(e) => void runAction(row.id, 'block', e)}
                                  className="rounded-lg border border-slate-300 p-1.5 text-rose-600 disabled:opacity-40 dark:border-slate-700"
                                  title="Bloquear"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canUnblock && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={(e) => void runAction(row.id, 'unblock', e)}
                                  className="rounded-lg border border-slate-300 p-1.5 text-emerald-600 disabled:opacity-40 dark:border-slate-700"
                                  title="Desbloquear"
                                >
                                  <Unlock className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {row.firstAccessStatus !== 'accepted' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={(e) => void resendFirstAccess(row, e)}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-indigo-700 disabled:opacity-40 dark:border-slate-700 dark:text-indigo-300"
                                title="Reenviar convite"
                              >
                                Reenviar convite
                              </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={(e) => void generateTemporaryPassword(row, e)}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-amber-700 disabled:opacity-40 dark:border-slate-700 dark:text-amber-300"
                                title="Gerar nova senha provisória"
                              >
                                Gerar senha
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={(e) => void deleteCompany(row, e)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-300"
                                title="Excluir empresa (limpeza de teste)"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Excluir
                              </button>
                            </>
                          )}
                        </div>
                        {row.id.startsWith('tn_') && temporaryPasswordByTenantId[row.id] && (
                          <div className="mt-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-900 dark:text-amber-200">
                            Senha: <strong>{temporaryPasswordByTenantId[row.id].value}</strong>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
