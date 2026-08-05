import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Pencil, Plus, Power, RefreshCw, X } from 'lucide-react';
import { hasMasterPermission } from '../api/masterApi';
import {
  createSaasPlan,
  fetchSaasPlans,
  formatPlanPrice,
  setSaasPlanActive,
  updateSaasPlan,
  type SaasPlan,
  type SaasPlanCycle,
  type SaveSaasPlanInput,
} from '../api/plansApi';

const EMPTY: SaveSaasPlanInput = {
  name: '', cycle: 'MONTHLY', priceCents: 0,
  employeeLimit: 0, userLimit: 0, enabledModules: [], active: true,
};

export function MasterPlansPage() {
  const canWrite = hasMasterPermission('subscriptions:write');
  const [plans, setPlans] = useState<SaasPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SaasPlan | null>(null);
  const [form, setForm] = useState<SaveSaasPlanInput>(EMPTY);
  const [modulesText, setModulesText] = useState('PONTO, RH');
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setPlans(await fetchSaasPlans(true)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar planos.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function startCreate() {
    setEditing(null); setForm(EMPTY); setModulesText('PONTO, RH'); setShowForm(true);
  }

  function startEdit(plan: SaasPlan) {
    setEditing(plan);
    setForm({
      name: plan.name, cycle: plan.cycle, priceCents: plan.priceCents,
      employeeLimit: plan.employeeLimit, userLimit: plan.userLimit,
      enabledModules: plan.enabledModules, active: plan.active,
    });
    setModulesText(plan.enabledModules.join(', '));
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const payload = {
      ...form,
      enabledModules: modulesText.split(',').map((m) => m.trim()).filter(Boolean),
    };
    try {
      const saved = editing
        ? await updateSaasPlan(editing.id, payload)
        : await createSaasPlan(payload);
      setPlans((prev) => editing
        ? prev.map((p) => p.id === saved.id ? saved : p)
        : [...prev, saved]);
      setShowForm(false); setEditing(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar plano.'); }
    finally { setBusy(false); }
  }

  async function toggle(plan: SaasPlan) {
    setBusy(true); setError(null);
    try {
      const updated = await setSaasPlanActive(plan.id, !plan.active);
      setPlans((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao alterar status.'); }
    finally { setBusy(false); }
  }

  const monthly = useMemo(() => plans.filter((p) => p.cycle === 'MONTHLY').length, [plans]);
  const annual = plans.length - monthly;

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/master"
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Início
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500">Comercial</p>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Planos SaaS</h2>
          <p className="text-sm text-slate-500">{monthly} mensais · {annual} anuais</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} className="rounded-xl border px-3 py-2 text-xs dark:border-slate-700">
            <RefreshCw className={`inline h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />Atualizar
          </button>
          {canWrite && <button onClick={startCreate} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs text-white"><Plus className="inline h-3.5 w-3.5 mr-1" />Novo plano</button>}
        </div>
      </header>

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-600">{error}</p>}

      {showForm && canWrite && (
        <form onSubmit={save} className="grid gap-3 rounded-2xl border border-indigo-500/20 bg-white p-4 dark:bg-slate-900 md:grid-cols-3">
          <label className="text-xs">Nome<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Ciclo<select value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value as SaasPlanCycle })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950"><option value="MONTHLY">Mensal</option><option value="ANNUAL">Anual (12 meses)</option></select></label>
          <label className="text-xs">Preço (R$)<input type="number" min="0" step="0.01" value={(form.priceCents / 100).toFixed(2)} onChange={(e) => setForm({ ...form, priceCents: Math.round(Number(e.target.value) * 100) })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Limite funcionários<input type="number" min="0" value={form.employeeLimit} onChange={(e) => setForm({ ...form, employeeLimit: Number(e.target.value) })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Limite usuários<input type="number" min="0" value={form.userLimit} onChange={(e) => setForm({ ...form, userLimit: Number(e.target.value) })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Módulos (separados por vírgula)<input value={modulesText} onChange={(e) => setModulesText(e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <div className="md:col-span-3 flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-lg border px-3 py-2 text-xs"><X className="inline h-3.5 w-3.5" /> Cancelar</button><button disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white"><Check className="inline h-3.5 w-3.5" /> Salvar</button></div>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.id} className={`rounded-2xl border bg-white p-4 dark:bg-slate-900 ${plan.active ? 'border-slate-200 dark:border-slate-800' : 'border-rose-500/30 opacity-70'}`}>
            <div className="flex justify-between gap-2"><div><h3 className="font-semibold text-slate-900 dark:text-white">{plan.name}</h3><p className="text-xs text-slate-500">{plan.cycle === 'ANNUAL' ? 'Anual · 12 meses' : 'Mensal'}</p></div><span className={`h-fit rounded-full px-2 py-0.5 text-[10px] ${plan.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>{plan.active ? 'ATIVO' : 'INATIVO'}</span></div>
            <p className="my-4 text-2xl font-semibold text-indigo-600">{formatPlanPrice(plan.priceCents)}<span className="text-xs font-normal text-slate-500">/{plan.cycle === 'ANNUAL' ? 'ano' : 'mês'}</span></p>
            <div className="grid grid-cols-2 text-xs text-slate-600 dark:text-slate-300"><p>{plan.employeeLimit} funcionários</p><p>{plan.userLimit} usuários</p></div>
            <div className="mt-3 flex flex-wrap gap-1">{plan.enabledModules.map((m) => <span key={m} className="rounded bg-slate-100 px-2 py-1 text-[10px] dark:bg-slate-800">{m}</span>)}</div>
            {canWrite && <div className="mt-4 flex justify-end gap-2"><button onClick={() => startEdit(plan)} className="rounded-lg border px-2 py-1 text-xs"><Pencil className="inline h-3 w-3" /> Editar</button><button disabled={busy} onClick={() => void toggle(plan)} className="rounded-lg border px-2 py-1 text-xs"><Power className="inline h-3 w-3" /> {plan.active ? 'Desativar' : 'Ativar'}</button></div>}
          </article>
        ))}
      </div>
      {!loading && plans.length === 0 && <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-slate-500">Nenhum plano cadastrado.</p>}
    </div>
  );
}

export default MasterPlansPage;
