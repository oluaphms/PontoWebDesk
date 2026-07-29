import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserX,
  UsersRound,
} from 'lucide-react';
import {
  createMasterUser,
  getMasterSession,
  hasMasterPermission,
  listMasterUsers,
  resetMasterUserPassword,
  updateMasterUser,
  type MasterRole,
  type MasterUser,
} from '../api/masterApi';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';

const ROLES: MasterRole[] = [
  'MASTER_OWNER',
  'MASTER_ADMIN',
  'MASTER_SUPPORT',
  'MASTER_FINANCE',
  'MASTER_AUDITOR',
];

const ROLE_LABEL: Record<MasterRole, string> = {
  MASTER_OWNER: 'Proprietário',
  MASTER_ADMIN: 'Administrador',
  MASTER_SUPPORT: 'Suporte',
  MASTER_FINANCE: 'Financeiro',
  MASTER_AUDITOR: 'Auditor',
};

const ROLE_SCOPE: Record<MasterRole, string> = {
  MASTER_OWNER: 'Acesso total, inclusive gestão de proprietários.',
  MASTER_ADMIN: 'Operação do Master, sem alterar proprietários.',
  MASTER_SUPPORT: 'Suporte técnico e futura sessão assistida.',
  MASTER_FINANCE: 'Licenças, cobranças e bloqueios.',
  MASTER_AUDITOR: 'Somente leitura e registros.',
};

type CreateForm = {
  name: string;
  email: string;
  password: string;
  role: MasterRole;
};

const EMPTY_FORM: CreateForm = {
  name: '',
  email: '',
  password: '',
  role: 'MASTER_SUPPORT',
};

export function MasterUsersPage() {
  const session = getMasterSession();
  const canWrite = hasMasterPermission('users:write');
  const canManageOwners = hasMasterPermission('owners:write');
  const [users, setUsers] = useState<MasterUser[]>([]);
  const [mfaSupported, setMfaSupported] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [resetTarget, setResetTarget] = useState<MasterUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const allowedCreateRoles = useMemo(
    () => (canManageOwners ? ROLES : ROLES.filter((role) => role !== 'MASTER_OWNER')),
    [canManageOwners],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await listMasterUsers();
      setUsers(data.users);
      setMfaSupported(data.mfaSupported);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar usuários Master.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function canManage(user: MasterUser): boolean {
    return canWrite && (user.role !== 'MASTER_OWNER' || canManageOwners);
  }

  function isFounder(user: MasterUser): boolean {
    return user.isFounder === true;
  }

  const sessionIsFounder = users.some((u) => u.id === session?.userId && u.isFounder);

  function canResetFounderPassword(user: MasterUser): boolean {
    if (!isFounder(user)) return canManage(user);
    return canManage(user) && sessionIsFounder;
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusyId('create');
    try {
      await createMasterUser(form);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      setNotice('Usuário Master criado.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar usuário.');
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(user: MasterUser, role: MasterRole) {
    if (user.isFounder) {
      setError('Conta Founder protegida: o perfil não pode ser alterado.');
      return;
    }
    if (role === user.role) return;
    setBusyId(user.id);
    setError(null);
    try {
      await updateMasterUser(user.id, { role });
      setNotice('Perfil alterado; sessões anteriores foram revogadas.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alterar perfil.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(user: MasterUser) {
    if (user.isFounder) {
      setError('Conta Founder protegida: não pode ser bloqueada ou desativada.');
      return;
    }
    const action = user.active ? 'bloquear' : 'reativar';
    if (!window.confirm(`Deseja ${action} ${user.email}? As sessões serão revogadas.`)) return;
    setBusyId(user.id);
    setError(null);
    try {
      await updateMasterUser(user.id, { active: !user.active });
      setNotice(user.active ? 'Usuário bloqueado.' : 'Usuário reativado.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao ${action} usuário.`);
    } finally {
      setBusyId(null);
    }
  }

  async function submitPasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setBusyId(resetTarget.id);
    setError(null);
    try {
      await resetMasterUserPassword(resetTarget.id, newPassword);
      setResetTarget(null);
      setNewPassword('');
      setNotice('Senha redefinida; todas as sessões do usuário foram revogadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao redefinir senha.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <MasterBackToDashboard />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500">
            Administração
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-white">
            <UsersRound className="h-6 w-6 text-indigo-500" />
            Usuários Master
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Contas persistentes, perfis e bloqueios do Painel Master.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Novo usuário
            </button>
          )}
        </div>
      </header>

      {(error || notice) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error
              ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
          }`}
        >
          {error || notice}
        </div>
      )}

      {showCreate && canWrite && (
        <form
          onSubmit={createUser}
          className="grid gap-3 rounded-2xl border border-border bg-surface shadow-card p-5 md:grid-cols-2 "
        >
          <h3 className="md:col-span-2 text-sm font-semibold">Criar usuário Master</h3>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            placeholder="Nome"
            className="rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
            placeholder="E-mail"
            className="rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
            placeholder="Senha individual (mínimo 8 caracteres)"
            className="rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <select
            value={form.role}
            onChange={(e) =>
              setForm((current) => ({ ...current, role: e.target.value as MasterRole }))
            }
            className="rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            {allowedCreateRoles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]} — {ROLE_SCOPE[role]}
              </option>
            ))}
          </select>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busyId === 'create'}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Criar
            </button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-border bg-\[var\(--ds-table-head\)\] text-xs uppercase text-foreground-secondary">
              <tr>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Perfil / permissões</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3">MFA</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((user) => {
                const manageable = canManage(user);
                const founder = isFounder(user);
                const canEditRole = manageable && !founder;
                const canBlock = manageable && !founder;
                const canReset = canResetFounderPassword(user);
                const roleOptions = canManageOwners
                  ? ROLES
                  : ROLES.filter((role) => role !== 'MASTER_OWNER');
                return (
                  <tr key={user.id} className={!user.active ? 'opacity-60' : ''}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-white">
                        {user.name}
                        {user.id === session?.userId && (
                          <span className="ml-2 text-[10px] text-indigo-500">VOCÊ</span>
                        )}
                        {founder && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                            Fundador
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                      {founder && (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                          Conta protegida — não pode ser excluída, bloqueada ou rebaixada.
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEditRole ? (
                        <select
                          value={user.role}
                          disabled={busyId === user.id}
                          onChange={(e) => void changeRole(user, e.target.value as MasterRole)}
                          className="rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-medium">{ROLE_LABEL[user.role]}</span>
                      )}
                      <p className="mt-1 max-w-xs text-xs text-slate-500">
                        {ROLE_SCOPE[user.role]}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                          user.active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                        }`}
                      >
                        {user.active ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                        {user.active ? 'Ativo' : 'Bloqueado'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled
                        title="MFA ainda não implementado no servidor"
                        className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-400 dark:border-slate-800"
                      >
                        <ShieldCheck className="h-3 w-3" />
                        {mfaSupported ? 'Configurar' : 'Indisponível'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={!canReset || busyId === user.id}
                          title={
                            founder && !sessionIsFounder
                              ? 'Somente outro Founder pode redefinir esta senha'
                              : undefined
                          }
                          onClick={() => {
                            setResetTarget(user);
                            setNewPassword('');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700"
                        >
                          <KeyRound className="h-3 w-3" />
                          Redefinir senha
                        </button>
                        <button
                          type="button"
                          disabled={!canBlock || busyId === user.id}
                          title={
                            founder
                              ? 'Conta Founder não pode ser bloqueada'
                              : undefined
                          }
                          onClick={() => void toggleActive(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700"
                        >
                          <LockKeyhole className="h-3 w-3" />
                          {user.active ? 'Bloquear' : 'Reativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    Nenhum usuário Master cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rounded-xl border border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">
        Permissões são herdadas do perfil. Não há permissões avulsas por usuário, evitando
        combinações difíceis de auditar.
      </div>

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={submitPasswordReset}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
          >
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Redefinir senha</h3>
              <p className="mt-1 text-sm text-slate-500">{resetTarget.email}</p>
            </div>
            <input
              autoFocus
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nova senha individual"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <p className="text-xs text-amber-600 dark:text-amber-300">
              Todas as sessões atuais deste usuário serão encerradas.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetTarget(null)} className="px-3 py-2 text-sm">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busyId === resetTarget.id}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Redefinir
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
