import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Pencil, UserX, Trash2, Eye, UserCheck, Search } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, auth, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

interface EmployeeRow {
  id: string;
  nome: string;
  cpf?: string;
  email: string;
  phone?: string;
  cargo: string;
  department_id?: string;
  department_name?: string;
  schedule_id?: string;
  schedule_name?: string;
  status: string;
  created_at: string;
}

interface ScheduleOption {
  id: string;
  name: string;
}

const AdminEmployees: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome: '',
    cpf: '',
    email: '',
    password: '',
    phone: '',
    cargo: 'Colaborador',
    department_id: '',
    schedule_id: '',
  });
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const [usersRows, schedRows, deptRows] = await Promise.all([
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'created_at', ascending: false }) as Promise<any[]>,
        db.select('schedules', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('departments', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
      ]);
      const deptMap = new Map((deptRows ?? []).map((d: any) => [d.id, d.name]));
      const schedMap = new Map((schedRows ?? []).map((s: any) => [s.id, s.name]));
      const list = (usersRows ?? []).map((u: any) => ({
        id: u.id,
        nome: u.nome || '',
        cpf: u.cpf,
        email: u.email || '',
        phone: u.phone,
        cargo: u.cargo || 'Colaborador',
        department_id: u.department_id,
        department_name: u.department_id ? deptMap.get(u.department_id) : undefined,
        schedule_id: u.schedule_id,
        schedule_name: u.schedule_id ? schedMap.get(u.schedule_id) : undefined,
        status: u.status || 'active',
        created_at: u.created_at,
      }));
      setRows(list);
      setSchedules((schedRows ?? []).map((s: any) => ({ id: s.id, name: s.name })));
      setDepartments((deptRows ?? []).map((d: any) => ({ id: d.id, name: d.name })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.companyId]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ nome: '', cpf: '', email: '', password: '', phone: '', cargo: 'Colaborador', department_id: '', schedule_id: '' });
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const openEdit = (row: EmployeeRow) => {
    setEditingId(row.id);
    setForm({
      nome: row.nome,
      cpf: row.cpf || '',
      email: row.email,
      password: '',
      phone: row.phone || '',
      cargo: row.cargo,
      department_id: row.department_id || '',
      schedule_id: row.schedule_id || '',
    });
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    if (!form.nome.trim()) {
      setError('Informe o nome.');
      return;
    }
    if (!editingId && !form.email.trim()) {
      setError('Informe o e-mail.');
      return;
    }
    if (!editingId && !form.password.trim()) {
      setError('Informe a senha inicial para o funcionário.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        await db.update('users', editingId, {
          nome: form.nome.trim(),
          cpf: form.cpf || null,
          phone: form.phone || null,
          cargo: form.cargo,
          department_id: form.department_id || null,
          schedule_id: form.schedule_id || null,
        });
        setSuccess('Funcionário atualizado com sucesso.');
        setModalOpen(false);
        loadData();
      } else {
        const email = form.email.trim().toLowerCase();
        const authData = await auth.signUp(email, form.password, { nome: form.nome, cargo: form.cargo });
        if (!authData?.user?.id) throw new Error('Conta criada mas ID não retornado.');
        await db.insert('users', {
          id: authData.user.id,
          nome: form.nome.trim(),
          cpf: form.cpf || null,
          email,
          phone: form.phone || null,
          cargo: form.cargo,
          role: 'employee',
          company_id: user.companyId,
          department_id: form.department_id || null,
          schedule_id: form.schedule_id || null,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setSuccess('Funcionário cadastrado. Ele pode acessar com o e-mail e a senha informados.');
        setModalOpen(false);
        setForm({ ...form, password: '' });
        loadData();
      }
    } catch (e: any) {
      setError(e?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Desativar este funcionário?')) return;
    try {
      await db.update('users', id, { status: 'inactive', updated_at: new Date().toISOString() });
      setSuccess('Funcionário desativado.');
      loadData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao desativar');
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await db.update('users', id, { status: 'active', updated_at: new Date().toISOString() });
      setSuccess('Funcionário reativado.');
      loadData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao reativar');
    }
  };

  const searchLower = search.trim().toLowerCase();
  const filteredRows = searchLower
    ? rows.filter(
        (r) =>
          r.nome.toLowerCase().includes(searchLower) ||
          (r.email && r.email.toLowerCase().includes(searchLower)) ||
          (r.cpf && r.cpf.replace(/\D/g, '').includes(searchLower))
      )
    : rows;

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este funcionário? Esta ação não pode ser desfeita.')) return;
    try {
      await db.delete('users', id);
      setSuccess('Funcionário excluído.');
      loadData();
    } catch (e: any) {
      setError(e?.message || 'Erro ao excluir');
    }
  };

  if (loading || !user) return <LoadingState message="Carregando..." />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
        {success && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
            {success}
          </div>
        )}
        {error && !modalOpen && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader title="Funcionários" />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
          >
            <UserPlus className="w-5 h-5" /> Cadastrar Funcionário
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou CPF..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 text-sm"
            />
          </div>
          {search && (
            <span className="text-sm text-slate-500 dark:text-slate-400 self-center">
              {filteredRows.length} de {rows.length} resultado(s)
            </span>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nome</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">CPF</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Cargo</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Departamento</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Escala</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">{row.nome}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.cpf || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.cargo}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.department_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.schedule_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-lg text-xs font-medium ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                          {row.status === 'active' ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" onClick={() => navigate('/admin/timesheet?user=' + row.id)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Ver Espelho"><Eye className="w-4 h-4" /></button>
                          <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Editar"><Pencil className="w-4 h-4" /></button>
                          {row.status === 'active' ? (
                            <button type="button" onClick={() => handleDeactivate(row.id)} className="p-2 text-slate-500 hover:text-amber-600 rounded-lg" title="Desativar"><UserX className="w-4 h-4" /></button>
                          ) : (
                            <button type="button" onClick={() => handleReactivate(row.id)} className="p-2 text-slate-500 hover:text-emerald-600 rounded-lg" title="Reativar"><UserCheck className="w-4 h-4" /></button>
                          )}
                          <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum funcionário cadastrado.</p>
              )}
              {rows.length > 0 && filteredRows.length === 0 && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum resultado para &quot;{search}&quot;.</p>
              )}
            </div>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => !saving && setModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Funcionário' : 'Cadastrar Funcionário'}</h3>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="grid grid-cols-1 gap-3">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nome</label>
                <input type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Nome completo" />
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">CPF</label>
                <input type="text" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="CPF" />
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="email@empresa.com" disabled={!!editingId} />
                {!editingId && (
                  <>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Senha inicial</label>
                    <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Senha para primeiro acesso" autoComplete="new-password" />
                  </>
                )}
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Telefone</label>
                <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Telefone" />
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Cargo</label>
                <input type="text" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Cargo" />
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Departamento</label>
                <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                  <option value="">Nenhum</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Escala</label>
                <select value={form.schedule_id} onChange={(e) => setForm({ ...form, schedule_id: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                  <option value="">Nenhuma</option>
                  {schedules.map((s) => (
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
    </RoleGuard>
  );
};

export default AdminEmployees;
