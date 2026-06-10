import React, { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { db } from '../../services/supabaseClient';
import { formatMinutes } from '../../utils/timesheetMirror';
import {
  createSobreAvisoPeriod,
  listSobreAvisoByUser,
  sumSobreAvisoMinutes,
  type SobreAvisoRow,
} from '../../services/sobreAviso.service';

type EmployeeOption = { id: string; nome: string };

export const SobreAvisoCadastroPanel: React.FC = () => {
  const { user } = useCurrentUser();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [rows, setRows] = useState<SobreAvisoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    user_id: '',
    data_inicial: '',
    data_final: '',
    hora_inicial: '18:00',
    hora_fim: '08:00',
  });

  useEffect(() => {
    if (!user?.companyId) return;
    void (async () => {
      const list = (await db.select('users', [
        { column: 'company_id', operator: 'eq', value: user.companyId },
        { column: 'status', operator: 'eq', value: 'active' },
      ])) as { id: string; nome?: string; email?: string }[];
      setEmployees(
        (list ?? [])
          .map((r) => ({
            id: r.id,
            nome: String(r.nome || r.email || r.id).trim(),
          }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      );
    })();
  }, [user?.companyId]);

  const reloadRows = useCallback(async () => {
    if (!user?.companyId || !form.user_id || !form.data_inicial || !form.data_final) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listSobreAvisoByUser(
        user.companyId,
        form.user_id,
        form.data_inicial,
        form.data_final,
      );
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [user?.companyId, form.user_id, form.data_inicial, form.data_final]);

  useEffect(() => {
    void reloadRows();
  }, [reloadRows]);

  const totalMinutes = sumSobreAvisoMinutes(rows);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.companyId) return;
    setMessage(null);
    const { inserted, error } = await createSobreAvisoPeriod({
      user_id: form.user_id,
      company_id: user.companyId,
      data_inicial: form.data_inicial,
      data_final: form.data_final,
      hora_inicial: form.hora_inicial,
      hora_fim: form.hora_fim,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(`${inserted} registro(s) de sobreaviso cadastrado(s).`);
    await reloadRows();
  };

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4 md:p-6 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Horas de Sobreaviso</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Cadastro de períodos de disponibilidade fora do expediente. O cálculo na folha será integrado futuramente.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-300">Colaborador</span>
          <select
            required
            value={form.user_id}
            onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          >
            <option value="">Selecione</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-300">Data inicial</span>
          <input
            type="date"
            required
            value={form.data_inicial}
            onChange={(e) => setForm((f) => ({ ...f, data_inicial: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-300">Data final</span>
          <input
            type="date"
            required
            value={form.data_final}
            onChange={(e) => setForm((f) => ({ ...f, data_final: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-300">Horário inicial</span>
          <input
            type="time"
            required
            value={form.hora_inicial}
            onChange={(e) => setForm((f) => ({ ...f, hora_inicial: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-300">Horário final</span>
          <input
            type="time"
            required
            value={form.hora_fim}
            onChange={(e) => setForm((f) => ({ ...f, hora_fim: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5"
          >
            Cadastrar período
          </button>
        </div>
      </form>

      {message ? <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p> : null}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          Total no período: {formatMinutes(totalMinutes)}
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          {loading ? 'Carregando…' : `${rows.length} registro(s)`}
        </span>
      </div>
    </section>
  );
};
